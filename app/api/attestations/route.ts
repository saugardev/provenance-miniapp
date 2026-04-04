import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { resolveRuntimeStateDir } from "../../../src/runtime-state-dir.ts";
import { loadState } from "../../../src/state.ts";

export const runtime = "nodejs";

export async function GET() {
  const statePath = resolve(resolveRuntimeStateDir(), "backend-state.json");
  const state = loadState(statePath);
  return NextResponse.json({
    ok: true,
    count: state.submissions.length,
    submissions: state.submissions,
  });
}
