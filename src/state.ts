import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WorldcoinFirstEntryPayload } from "./worldcoin-first-entry.ts";

export type SubmissionRecord = {
  submitted_at_ms: number;
  payload: WorldcoinFirstEntryPayload;
};

export type BackendState = {
  submissions: SubmissionRecord[];
};

const DEFAULT_STATE: BackendState = {
  submissions: [],
};

export function loadState(path: string): BackendState {
  if (!existsSync(path)) return DEFAULT_STATE;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as BackendState;
  return {
    submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
  };
}

export function saveState(path: string, state: BackendState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export function appendSubmission(state: BackendState, payload: WorldcoinFirstEntryPayload): BackendState {
  const submissions = state.submissions.slice();
  submissions.push({ submitted_at_ms: Date.now(), payload });
  return { ...state, submissions };
}

/**
 * Returns true when a submission already exists for the same
 * (nullifier, action, content_hash) tuple.
 *
 * Nullifiers are stable per (user, action), so users can legitimately submit
 * multiple different images for the same action. We only block exact replay of
 * the same content hash under the same identity/action.
 */
export function hasSubmissionForNullifierActionContent(
  state: BackendState,
  nullifierHash: string,
  action: string,
  contentHash: string,
): boolean {
  const normalizedNullifier = String(nullifierHash ?? "").trim();
  const normalizedAction = String(action ?? "").trim();
  const normalizedContentHash = String(contentHash ?? "").trim();
  if (!normalizedNullifier || !normalizedAction || !normalizedContentHash) return false;

  return state.submissions.some((submission) => {
    const proof = submission?.payload?.worldcoin_proof;
    const entry = submission?.payload?.entry;
    return (
      String(proof?.nullifier_hash ?? "").trim() === normalizedNullifier
      && String(proof?.action ?? "").trim() === normalizedAction
      && String(entry?.content_hash ?? "").trim() === normalizedContentHash
    );
  });
}
