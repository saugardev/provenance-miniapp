import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { appendSubmission, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import { verifyWorldcoinProof } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  worldcoin_proof?: {
    action?: string;
    signal?: string;
    proof?: string;
    merkle_root?: string;
    nullifier_hash?: string;
    verification_level?: string;
    version?: number;
  };
};

function isSha256Hash(v: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmitBody;

    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body?.timestamp_ms) : Date.now();

    const proofInput = body?.worldcoin_proof ?? {};
    const action = String(proofInput?.action ?? "").trim();
    const signal = proofInput?.signal ? String(proofInput.signal) : undefined;
    const proof = String(proofInput?.proof ?? "").trim();
    const merkle_root = String(proofInput?.merkle_root ?? "").trim();
    const nullifier_hash = String(proofInput?.nullifier_hash ?? "").trim();
    const verification_level = String(proofInput?.verification_level ?? "").trim();
    const version = Number.isFinite(Number(proofInput?.version)) ? Number(proofInput?.version) : undefined;

    if (!content_id || !content_hash) {
      return NextResponse.json({ error: "content_id, content_hash are required" }, { status: 400 });
    }
    if (!isSha256Hash(content_hash)) {
      return NextResponse.json({ error: "content_hash must match sha256:<64-hex>" }, { status: 400 });
    }
    if (!action || !proof || !merkle_root || !nullifier_hash || !verification_level) {
      return NextResponse.json(
        {
          error: "worldcoin_proof.action, proof, merkle_root, nullifier_hash, verification_level are required",
        },
        { status: 400 },
      );
    }

    const verification = await verifyWorldcoinProof({
      action,
      signal,
      proof,
      merkle_root,
      nullifier_hash,
      verification_level,
    });

    if (!verification.success) {
      return NextResponse.json(
        {
          error: "worldcoin proof verification failed",
          detail: verification.detail,
        },
        { status: 401 },
      );
    }

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
      version,
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
      latest_path: latestPath,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
