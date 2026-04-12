import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const projectRoot = process.cwd();
const rollupPackagePath = path.join(
  projectRoot,
  "node_modules",
  "rollup",
  "package.json"
);

if (!fs.existsSync(rollupPackagePath)) {
  process.exit(0);
}

const rollupPackage = JSON.parse(fs.readFileSync(rollupPackagePath, "utf8"));
const optionalDependencies = rollupPackage.optionalDependencies ?? {};
const rollupVersion = rollupPackage.version;
const require = createRequire(import.meta.url);

function getLibcVariant() {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report?.getReport?.();
  const glibcVersion = report?.header?.glibcVersionRuntime;
  return glibcVersion ? "gnu" : "musl";
}

function getRollupNativePackageName() {
  const { platform, arch } = process;
  const libc = getLibcVariant();

  if (platform === "darwin" && arch === "arm64") {
    return "@rollup/rollup-darwin-arm64";
  }

  if (platform === "darwin" && arch === "x64") {
    return "@rollup/rollup-darwin-x64";
  }

  if (platform === "linux" && arch === "x64") {
    return `@rollup/rollup-linux-x64-${libc}`;
  }

  if (platform === "linux" && arch === "arm64") {
    return `@rollup/rollup-linux-arm64-${libc}`;
  }

  if (platform === "linux" && arch === "arm") {
    return `@rollup/rollup-linux-arm-${libc}eabihf`;
  }

  if (platform === "win32" && arch === "x64") {
    return "@rollup/rollup-win32-x64-msvc";
  }

  if (platform === "win32" && arch === "arm64") {
    return "@rollup/rollup-win32-arm64-msvc";
  }

  if (platform === "win32" && arch === "ia32") {
    return "@rollup/rollup-win32-ia32-msvc";
  }

  return null;
}

const targetPackage = getRollupNativePackageName();

if (!targetPackage || !(targetPackage in optionalDependencies)) {
  process.exit(0);
}

try {
  const resolvedPath = require.resolve(`${targetPackage}/package.json`, {
    paths: [projectRoot]
  });

  if (resolvedPath) {
    process.exit(0);
  }
} catch {
  // Fall through to installation.
}

console.log(
  `[rollup-native] Missing ${targetPackage}; installing ${targetPackage}@${rollupVersion}...`
);

const result = spawnSync(
  "npm",
  [
    "install",
    "--no-save",
    "--no-fund",
    "--no-audit",
    `${targetPackage}@${rollupVersion}`
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
