import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { appendSubmission, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import { verifyIdKitResponseFlexible, verifyWorldcoinProof } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  idkit_response?: unknown;
  worldcoin_proof?: {
    action?: string;
    signal?: string;
    proof?: string;
    merkle_root?: string;
    nullifier_hash?: string;
    verification_level?: string;
    version?: number;
    nonce?: string;
  };
};

function isSha256Hash(v: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(v);
}

function isAllowedVerificationLevel(level: string): boolean {
  return level === "orb" || level === "device";
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
    const proofInput = body?.worldcoin_proof ?? {};
    let action = String(proofInput?.action ?? "").trim();
    const signal = content_hash;
    let proof = String(proofInput?.proof ?? "").trim();
    let merkle_root = String(proofInput?.merkle_root ?? "").trim();
    let nullifier_hash = String(proofInput?.nullifier_hash ?? "").trim();
    let verification_level = String(proofInput?.verification_level ?? "").trim();
    let version = Number.isFinite(Number(proofInput?.version)) ? Number(proofInput?.version) : undefined;
    let nonce = String(proofInput?.nonce ?? "").trim();

    let verification;
    if (body?.idkit_response) {
      verification = await verifyIdKitResponseFlexible(body.idkit_response);
      action = String(verification.parsed?.action ?? action).trim();
      proof = String(verification.parsed?.proof ?? proof).trim();
      merkle_root = String(verification.parsed?.merkle_root ?? merkle_root).trim();
      nullifier_hash = String(verification.parsed?.nullifier_hash ?? nullifier_hash).trim();
      verification_level = String(verification.parsed?.verification_level ?? verification_level).trim();
      nonce = String(verification.parsed?.nonce ?? nonce).trim();

      // Some MiniKit payload variants omit nonce in the first candidate.
      // If World explicitly asks for nonce and we have one from UI/fallback, retry once.
      const nonceRequired =
        !verification.success &&
        String((verification.detail as any)?.payload?.attribute ?? "") === "nonce" &&
        /required/i.test(String((verification.detail as any)?.payload?.detail ?? ""));
      if (nonceRequired && nonce) {
        verification = await verifyWorldcoinProof({
          action,
          signal,
          proof,
          merkle_root,
          nullifier_hash,
          verification_level,
          nonce,
        });
      }
    } else {
      if (!action || !proof || !merkle_root || !nullifier_hash || !verification_level) {
        return NextResponse.json(
          {
            error: "worldcoin_proof.action, proof, merkle_root, nullifier_hash, verification_level are required",
          },
          { status: 400 },
        );
      }
      verification = await verifyWorldcoinProof({
        action,
        signal,
        proof,
        merkle_root,
        nullifier_hash,
        verification_level,
        nonce,
      });
    }

    if (!isAllowedVerificationLevel(verification_level)) {
      return NextResponse.json(
        { error: "verification_level must be one of: orb, device" },
        { status: 400 },
      );
    }

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
      worldcoin_verification_input: {
        action,
        signal,
        proof,
        merkle_root,
        nullifier_hash,
        verification_level,
        version,
        nonce,
      },
      worldcoin_verification_result: verification.detail,
      latest_path: latestPath,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
