import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { publishPayloadTo0g } from "../../../src/og-storage.ts";
import { appendSubmission, hasSubmissionForNullifierAction, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import {
  verifyIdKitResponse,
  verifyMiniAppProof,
  extractIdkitFields,
  extractMiniAppFields,
  isMiniAppProof,
  shouldBypassInvalidAction,
} from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SignBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  gps_location?: {
    latitude?: number;
    longitude?: number;
    accuracy_meters?: number;
    captured_at_ms?: number;
  };
  idkitResponse?: unknown;
  idkit_response?: unknown;
  proof?: unknown;
  worldcoin_proof?: unknown;
};

export async function POST(req: Request) {
  console.log("[sign-provenance] request received");
  try {
    const body = (await req.json()) as SignBody;
    const idkitResponse = body?.idkitResponse ?? body?.idkit_response;

    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body.timestamp_ms) : Date.now();
    const gpsLatitude = Number(body?.gps_location?.latitude);
    const gpsLongitude = Number(body?.gps_location?.longitude);
    const gpsAccuracyMeters = Number.isFinite(Number(body?.gps_location?.accuracy_meters))
      ? Number(body?.gps_location?.accuracy_meters)
      : undefined;
    const gpsCapturedAtMs = Number.isFinite(Number(body?.gps_location?.captured_at_ms))
      ? Number(body?.gps_location?.captured_at_ms)
      : undefined;

    if (!content_id || !content_hash) {
      return NextResponse.json({ error: "content_id and content_hash are required" }, { status: 400 });
    }
    if (!/^sha256:[0-9a-f]{64}$/i.test(content_hash)) {
      return NextResponse.json({ error: "content_hash must be sha256:<64 hex chars>" }, { status: 400 });
    }
    if (!Number.isFinite(gpsLatitude) || !Number.isFinite(gpsLongitude)) {
      return NextResponse.json({ error: "gps_location.latitude and gps_location.longitude are required" }, { status: 400 });
    }

    const miniAppProof = body?.proof ?? body?.worldcoin_proof;
    if (!idkitResponse && !isMiniAppProof(miniAppProof)) {
      return NextResponse.json({ error: "idkitResponse or proof is required" }, { status: 400 });
    }

    const configuredAction =
      process.env.WORLDCOIN_ACTION?.trim() ?? process.env.NEXT_PUBLIC_WORLDCOIN_ACTION?.trim() ?? "";
    const resultAction = String((idkitResponse as any)?.action ?? "").trim();
    const action = configuredAction || resultAction || "upload-photo";

    let verification;
    let nullifier = "";
    let verificationLevel = "";
    let merkleRoot = "";
    let verificationBypassed = false;

    if (isMiniAppProof(miniAppProof)) {
      verification = await verifyMiniAppProof(miniAppProof, action, content_hash);
      if (!verification.success) {
        if (shouldBypassInvalidAction(verification.detail)) {
          verificationBypassed = true;
        } else {
          return NextResponse.json(
            { error: "World ID proof verification failed", detail: verification.detail },
            { status: 401 },
          );
        }
      }
      ({ nullifier, verificationLevel, merkleRoot } = extractMiniAppFields(miniAppProof));
    } else {
      const idkitPayload = { ...(idkitResponse as object), action };
      verification = await verifyIdKitResponse(idkitPayload);
      if (!verification.success) {
        return NextResponse.json(
          { error: "World ID proof verification failed", detail: verification.detail },
          { status: 401 },
        );
      }
      ({ nullifier, verificationLevel, merkleRoot } = extractIdkitFields(idkitPayload));
    }

    if (!nullifier) {
      return NextResponse.json({ error: "Verified IDKit payload is missing nullifier" }, { status: 400 });
    }

    const dataDir = resolve(process.cwd(), "state");
    const statePath = resolve(dataDir, "backend-state.json");
    const state = loadState(statePath);

    if (hasSubmissionForNullifierAction(state, nullifier, action)) {
      return NextResponse.json(
        { error: "This World ID has already submitted for this action (duplicate nullifier)." },
        { status: 409 },
      );
    }

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
      gps_location: {
        latitude: gpsLatitude,
        longitude: gpsLongitude,
        accuracy_meters: gpsAccuracyMeters,
        captured_at_ms: gpsCapturedAtMs ?? timestamp_ms,
      },
    };

    const mode = (process.env.WORLDCOIN_MODE?.toLowerCase() === "build" ? "build" : "dev") as "dev" | "build";
    const payload = buildWorldcoinFirstEntry(
      { mode, timestamp_ms, content_id, content_hash, worldcoin_proof: worldcoinProof },
      keyMaterial,
    );
    const ogStorage = await publishPayloadTo0g({
      payload,
      nullifierHash: nullifier,
      action,
      contentId: content_id,
    });

    mkdirSync(dataDir, { recursive: true });
    saveState(statePath, appendSubmission(state, payload));
    writeFileSync(resolve(dataDir, "latest-worldcoin-first-entry.json"), JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      signed: true,
      payload,
      bypassed: verificationBypassed,
      bypass_reason: verificationBypassed ? "invalid_action" : undefined,
      session_id: verification.session_id,
      nullifier_hash: nullifier,
      verification_level: verificationLevel,
      verification_environment: verification.environment,
      verification_detail: verification.detail,
      og_storage: ogStorage,
    });
  } catch (err) {
    console.error("[sign-provenance] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
