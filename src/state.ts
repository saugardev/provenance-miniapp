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
