import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { appendSubmission, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import { verifyIdKitResponse } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  idkit_response?: unknown;
};

function isSha256Hash(v: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(v);
}

// Extracts the key fields from an IDKitResult (v3 or v4)
function extractIdkitFields(result: unknown): {
  nullifier_hash: string;
  verification_level: string;
  action: string;
  merkle_root: string;
} {
  const r = result as any;
  const response0 = Array.isArray(r?.responses) ? r.responses[0] : undefined;

  return {
    // v3: nullifier, v4: nullifier (RP-scoped)
    nullifier_hash: String(response0?.nullifier ?? response0?.nullifier_hash ?? "").trim(),
    // v3/v4: identifier (e.g. "proof_of_human", "orb", "device")
    verification_level: String(response0?.identifier ?? "").trim(),
    // action is at the top level in v3/v4 uniqueness proofs
    action: String(r?.action ?? "").trim(),
    // v3 only — absent in v4 (embedded as 5th element of proof array)
    merkle_root: String(response0?.merkle_root ?? "").trim(),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmitBody;

    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body?.timestamp_ms) : Date.now();

    if (!content_id || !content_hash) {
      return NextResponse.json({ error: "content_id, content_hash are required" }, { status: 400 });
    }
    if (!isSha256Hash(content_hash)) {
      return NextResponse.json({ error: "content_hash must match sha256:<64-hex>" }, { status: 400 });
    }
    if (!body?.idkit_response) {
      return NextResponse.json({ error: "idkit_response is required" }, { status: 400 });
    }

    const configuredAction = String(process.env.WORLDCOIN_ACTION ?? "").trim();
    const signal = content_hash;

    // Verify the IDKit result directly — works for both v3 and v4 protocol versions
    const verification = await verifyIdKitResponse(body.idkit_response);

    if (!verification.success) {
      return NextResponse.json(
        {
          error: "worldcoin proof verification failed",
          detail: verification.detail,
        },
        { status: 401 },
      );
    }

    // Extract fields from the verified IDKit result
    const { nullifier_hash, verification_level, action: resultAction, merkle_root } = extractIdkitFields(body.idkit_response);
    const action = configuredAction || resultAction || "upload-photo";

    const dataDir = resolve(process.cwd(), "state");
    const statePath = resolve(dataDir, "backend-state.json");
    const latestPath = resolve(dataDir, "latest-worldcoin-first-entry.json");
    const privateKeyPath = resolve(dataDir, "signing_private_key.pem");
    const publicKeyPath = resolve(dataDir, "signing_public_key.pem");
    const keyMaterial = loadOrCreateKeyMaterial(privateKeyPath, publicKeyPath);

    const worldcoin_proof: WorldcoinProof = {
      proof_status: "verified",
      nullifier_hash,
      miniapp_session_id: verification.session_id || `session-${timestamp_ms}`,
      merkle_root,
      verification_level,
      version: undefined,
      action,
      signal,
    };

    const mode = ((process.env.WORLDCOIN_MODE ?? "dev").toLowerCase() === "build" ? "build" : "dev") as "dev" | "build";
    const payload = buildWorldcoinFirstEntry(
      {
        mode,
        timestamp_ms,
        content_id,
        content_hash,
        worldcoin_proof,
      },
      keyMaterial,
    );

    let state = loadState(statePath);
    state = appendSubmission(state, payload);
    saveState(statePath, state);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      payload,
      verification_environment: verification.environment,
      worldcoin_verification_result: verification.detail,
      latest_path: latestPath,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
