import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Returns a writable directory for ephemeral runtime state.
 *
 * - Use STATE_DIR when explicitly configured.
 * - On serverless runtimes where cwd is read-only (/var/task), use /tmp.
 * - Locally, keep using project ./state for convenience.
 */
export function resolveRuntimeStateDir(): string {
  const explicit = String(process.env.STATE_DIR ?? "").trim();
  if (explicit) return resolve(explicit);

  const cwd = process.cwd();
  if (cwd.startsWith("/var/task")) {
    return resolve(tmpdir(), "worldcoin-miniapp-state");
  }
  return resolve(cwd, "state");
}
