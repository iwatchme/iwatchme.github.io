import { execFileSync } from "node:child_process";
import process from "node:process";

export const defaultVaultName = process.env.OBSIDIAN_DEFAULT_VAULT || "Notes";

export function resolveVaultPath(name = defaultVaultName) {
  try {
    const output = execFileSync("obsidian", [`vault=${name}`, "vault", "info=path"], {
      encoding: "utf8"
    }).trim();

    if (!output) {
      throw new Error(`Vault "${name}" did not return a path.`);
    }

    return output;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : `Unable to resolve vault "${name}".`;
    throw new Error(reason);
  }
}
