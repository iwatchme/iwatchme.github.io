import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defaultVaultName, resolveVaultPath } from "./notes-vault.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const syncScript = path.join(scriptDir, "sync-obsidian.mjs");

let vaultPath;

try {
  vaultPath = resolveVaultPath(defaultVaultName);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [syncScript, "--vault", vaultPath, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
