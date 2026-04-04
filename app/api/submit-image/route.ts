import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { appendSubmission, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import { verifyIdKitResponse, extractIdkitFields } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  idkitResponse?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmitBody;

    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body.timestamp_ms) : Date.now();

    if (!content_id || !content_hash) {
      return NextResponse.json({ error: "content_id and content_hash are required" }, { status: 400 });
    }
    if (!/^sha256:[0-9a-f]{64}$/i.test(content_hash)) {
      return NextResponse.json({ error: "content_hash must be sha256:<64 hex chars>" }, { status: 400 });
    }
    if (!body?.idkitResponse) {
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }

    const configuredAction = process.env.WORLDCOIN_ACTION?.trim() ?? "";
    const resultAction = String((body.idkitResponse as any)?.action ?? "").trim();
    const action = configuredAction || resultAction || "upload-photo";

    // Inject action if absent — orbLegacy (v3) results may omit it
    const idkitPayload = { ...(body.idkitResponse as object), action };

    // Verify proof — forwards raw IDKitResult to /api/v4/verify/{rp_id}
    const verification = await verifyIdKitResponse(idkitPayload);
    if (!verification.success) {
      return NextResponse.json(
        { error: "World ID proof verification failed", detail: verification.detail },
        { status: 401 },
      );
    }

    const { nullifier, verificationLevel, merkleRoot } = extractIdkitFields(idkitPayload);

    // Build and sign the Livy provenance payload
    const dataDir = resolve(process.cwd(), "state");
    const keyMaterial = loadOrCreateKeyMaterial(
      resolve(dataDir, "signing_private_key.pem"),
      resolve(dataDir, "signing_public_key.pem"),
    );

    const worldcoinProof: WorldcoinProof = {
      proof_status: "verified",
      nullifier_hash: nullifier,
      miniapp_session_id: verification.session_id ?? `session-${timestamp_ms}`,
      merkle_root: merkleRoot,
      verification_level: verificationLevel,
      action,
      signal: content_hash,
    };

    const mode = (process.env.WORLDCOIN_MODE?.toLowerCase() === "build" ? "build" : "dev") as "dev" | "build";
    const payload = buildWorldcoinFirstEntry(
      { mode, timestamp_ms, content_id, content_hash, worldcoin_proof: worldcoinProof },
      keyMaterial,
    );

    const statePath = resolve(dataDir, "backend-state.json");
    const latestPath = resolve(dataDir, "latest-worldcoin-first-entry.json");
    mkdirSync(dataDir, { recursive: true });
    saveState(statePath, appendSubmission(loadState(statePath), payload));
    writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      payload,
      verification_environment: verification.environment,
      verification_detail: verification.detail,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
