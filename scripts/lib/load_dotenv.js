/**
 * Load repo-root `.env` into process.env (does not override existing env vars).
 */
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadRepoDotenv() {
  dotenv.config({ path: resolve(REPO_ROOT, ".env") });
}
