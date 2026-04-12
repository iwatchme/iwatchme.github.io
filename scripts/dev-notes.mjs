import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { defaultVaultName, resolveVaultPath } from "./notes-vault.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const astroCli = path.join(projectRoot, "node_modules", "astro", "astro.js");
const syncScript = path.join(scriptDir, "sync-obsidian.mjs");
const watchableExtensions = new Set([
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif"
]);

let vaultPath;

try {
  vaultPath = resolveVaultPath(defaultVaultName);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

let pendingReason = null;
let debounceTimer = null;
let syncRunning = false;
let watcherClosed = false;
let lastQueuedReason = null;
let lastQueuedAt = 0;

function normalizeRelativePath(filename) {
  return String(filename).replaceAll("\\", "/");
}

function shouldSyncFor(relativePath) {
  if (!relativePath) {
    return true;
  }

  if (
    relativePath.startsWith(".obsidian/") ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith("node_modules/")
  ) {
    return false;
  }

  const ext = path.extname(relativePath).toLowerCase();
  return watchableExtensions.has(ext);
}

function runSync(reason, strict = false) {
  syncRunning = true;
  console.log(`[notes] syncing from ${defaultVaultName}: ${reason}`);

  const result = spawnSync(
    process.execPath,
    [syncScript, "--vault", vaultPath],
    { stdio: "inherit" }
  );

  syncRunning = false;

  const status = result.status ?? 1;

  if (status !== 0) {
    const message = "[notes] sync failed. Fix the note and save again to retry.";
    if (strict) {
      console.error(message);
      process.exit(status);
    }

    console.error(message);
  }

  if (pendingReason) {
    const nextReason = pendingReason;
    pendingReason = null;
    queueSync(nextReason);
  }
}

function queueSync(reason) {
  const now = Date.now();

  if (reason === lastQueuedReason && now - lastQueuedAt < 1500) {
    return;
  }

  lastQueuedReason = reason;
  lastQueuedAt = now;

  if (syncRunning) {
    pendingReason = reason;
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runSync(reason);
  }, 250);
}

runSync("initial sync", true);

const astroProcess = spawn(
  process.execPath,
  [astroCli, "dev", ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env
  }
);

const watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
  if (filename == null) {
    queueSync("vault change");
    return;
  }

  const relativePath = normalizeRelativePath(filename);
  if (!shouldSyncFor(relativePath)) {
    return;
  }

  queueSync(relativePath);
});

watcher.on("error", (error) => {
  console.error(
    `[notes] watcher error: ${error instanceof Error ? error.message : String(error)}`
  );
});

function closeWatcher() {
  if (watcherClosed) {
    return;
  }

  watcher.close();
  watcherClosed = true;
}

function shutdown(signal) {
  closeWatcher();

  if (!astroProcess.killed) {
    astroProcess.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

astroProcess.on("exit", (code, signal) => {
  closeWatcher();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
