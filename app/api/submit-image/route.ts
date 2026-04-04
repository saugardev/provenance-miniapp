/**
 * POST /api/submit-image
 *
 * Full submit pipeline:
 *   1. Re-verify the World ID proof server-side (don't trust frontend-only verification).
 *   2. Extract nullifier, verificationLevel, merkleRoot from the IDKitResult.
 *   3. Build and ED25519-sign a Livy provenance attestation payload.
 *   4. Persist the payload to state/ and return it.
 *
 * Uses v3 orbLegacy proofs (merkle_root included).
 *
 * Docs:
 *   Verify API:          https://docs.world.org/api-reference/developer-portal/verify
 *   Nullifier (concepts): https://docs.world.org/world-id/concepts
 *
 * Request:
 *   {
 *     content_id:    string           — stable identifier for the piece of content
 *     content_hash:  "sha256:<hex>"   — SHA-256 of the image (bound to the proof signal)
 *     timestamp_ms?: number           — defaults to Date.now()
 *     image_base64:  string           — base64 encoded image bytes
 *     image_mime_type?: string        — image mime type
 *     image_file_name?: string        — original file name
 *     image_size_bytes?: number       — original file size
 *     gps_location: {
 *       latitude: number,
 *       longitude: number,
 *       accuracy_meters?: number,
 *       captured_at_ms?: number
 *     }
 *     idkitResponse: IDKitResult      — raw result from World App
 *   }
 */

import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
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

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  consent_to_store_image?: boolean;
  consent_scope?: string;
  image_base64?: string;
  image_mime_type?: string;
  image_file_name?: string;
  image_size_bytes?: number;
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
  console.log("[submit-image] request received");
  try {
    const body = (await req.json()) as SubmitBody;
    const idkitResponse = body?.idkitResponse ?? body?.idkit_response;

    // --- Input validation ---
    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body.timestamp_ms) : Date.now();
    const consentToStoreImage = body?.consent_to_store_image !== false;
    const consentScope = String(body?.consent_scope ?? "").trim();
    const imageBase64 = String(body?.image_base64 ?? "").trim();
    const imageMimeType = String(body?.image_mime_type ?? "").trim() || "application/octet-stream";
    const imageFileName = String(body?.image_file_name ?? "").trim() || null;
    const imageSizeBytes = Number.isFinite(Number(body?.image_size_bytes)) ? Number(body?.image_size_bytes) : 0;
    const gpsLatitude = Number(body?.gps_location?.latitude);
    const gpsLongitude = Number(body?.gps_location?.longitude);
    const gpsAccuracyMeters = Number.isFinite(Number(body?.gps_location?.accuracy_meters))
      ? Number(body?.gps_location?.accuracy_meters)
      : undefined;
    const gpsCapturedAtMs = Number.isFinite(Number(body?.gps_location?.captured_at_ms))
      ? Number(body?.gps_location?.captured_at_ms)
      : undefined;

    if (!content_id || !content_hash) {
      console.warn("[submit-image] missing content_id or content_hash");
      return NextResponse.json({ error: "content_id and content_hash are required" }, { status: 400 });
    }
    if (!/^sha256:[0-9a-f]{64}$/i.test(content_hash)) {
      console.warn(`[submit-image] invalid content_hash format: "${content_hash}"`);
      return NextResponse.json({ error: "content_hash must be sha256:<64 hex chars>" }, { status: 400 });
    }
    const miniAppProof = body?.proof ?? body?.worldcoin_proof;
    if (!idkitResponse && !isMiniAppProof(miniAppProof)) {
      console.warn("[submit-image] missing idkitResponse/proof");
      return NextResponse.json({ error: "idkitResponse or proof is required" }, { status: 400 });
    }
    if (!consentToStoreImage) {
      console.warn("[submit-image] upload blocked due to denied storage consent");
      return NextResponse.json({ error: "Storage consent was denied by the user." }, { status: 403 });
    }
    if (!imageBase64) {
      console.warn("[submit-image] missing image_base64");
      return NextResponse.json({ error: "image_base64 is required for upload" }, { status: 400 });
    }
    if (!imageSizeBytes || imageSizeBytes <= 0) {
      console.warn("[submit-image] invalid image_size_bytes");
      return NextResponse.json({ error: "image_size_bytes must be greater than 0" }, { status: 400 });
    }
    if (!Number.isFinite(gpsLatitude) || !Number.isFinite(gpsLongitude)) {
      console.warn("[submit-image] missing gps_location coordinates");
      return NextResponse.json({ error: "gps_location.latitude and gps_location.longitude are required" }, { status: 400 });
    }

    console.log(`[submit-image] content_id="${content_id}" content_hash="${content_hash}" timestamp_ms=${timestamp_ms}`);

    // --- Resolve action (v3 orbLegacy may omit it) ---
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
      console.log(
        `[submit-image] verifying mini app proof action="${action}" verification_level="${miniAppProof.verification_level}"`,
      );
      verification = await verifyMiniAppProof(miniAppProof, action, content_hash);
      if (!verification.success) {
        if (shouldBypassInvalidAction(verification.detail)) {
          verificationBypassed = true;
          console.warn("[submit-image] bypassing mini app verification for invalid_action");
        } else {
          console.warn("[submit-image] ✗ mini app proof verification failed:", JSON.stringify(verification.detail));
          return NextResponse.json(
            { error: "World ID proof verification failed", detail: verification.detail },
            { status: 401 },
          );
        }
      }
      ({ nullifier, verificationLevel, merkleRoot } = extractMiniAppFields(miniAppProof));
    } else {
      const idkitPayload = { ...(idkitResponse as object), action };

      // --- Step 1: Re-verify proof server-side ---
      // Forwards IDKitResult as-is to /api/v4/verify/{rp_id}.
      console.log(
        `[submit-image] verifying proof action="${action}" protocol_version=${(idkitResponse as any)?.protocol_version ?? "unknown"}`,
      );
      verification = await verifyIdKitResponse(idkitPayload);
      if (!verification.success) {
        console.warn("[submit-image] ✗ mini app proof verification failed:", JSON.stringify(verification.detail));
        return NextResponse.json(
          { error: "World ID proof verification failed", detail: verification.detail },
          { status: 401 },
        );
      }
      ({ nullifier, verificationLevel, merkleRoot } = extractIdkitFields(idkitPayload));
    }

    console.log(
      `[submit-image] ✓ proof verified session_id="${verification.session_id ?? "(none)"}" environment="${verification.environment ?? "unknown"}"`,
    );

    // --- Step 2: Extract proof fields ---
    // nullifier  — unique per (user, action); used as a human-identity anchor.
    // merkleRoot — on-chain anchor for v3/mini app proofs.
    // verificationLevel — e.g. "orb".
    console.log(`[submit-image] nullifier="${nullifier}" verificationLevel="${verificationLevel}" merkleRoot="${merkleRoot || "(missing)"}"`);
    if (!nullifier) {
      console.warn("[submit-image] verified payload missing nullifier");
      return NextResponse.json(
        { error: "Verified IDKit payload is missing nullifier" },
        { status: 400 },
      );
    }

    // --- Step 3: Build and sign the Livy provenance payload ---
    const dataDir = resolve(process.cwd(), "state");
    const statePath = resolve(dataDir, "backend-state.json");
    const state = loadState(statePath);

    // Replay protection (World docs Step 6):
    // reject if this (nullifier, action) pair has already been submitted.
    if (hasSubmissionForNullifierAction(state, nullifier, action)) {
      console.warn(`[submit-image] duplicate nullifier replay blocked nullifier="${nullifier}" action="${action}"`);
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
      signal: content_hash, // signal was bound to the content hash in IDKit.request()
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

    // --- Step 4: Persist ---
    mkdirSync(dataDir, { recursive: true });
    saveState(statePath, appendSubmission(state, payload));
    writeFileSync(resolve(dataDir, "latest-worldcoin-first-entry.json"), JSON.stringify(payload, null, 2), "utf8");

    console.log(`[submit-image] ✓ payload built and persisted signature="${payload.signature.slice(0, 16)}..."`);

    let imageRecordId: number | null = null;
    try {
      const { persistUploadedImage } = await import("../../../src/image-store.ts");
      imageRecordId = await persistUploadedImage({
        contentId: content_id,
        contentHash: content_hash,
        action,
        nullifierHash: nullifier,
        verificationLevel,
        merkleRoot,
        imageBase64,
        imageMimeType,
        imageFileName,
        imageSizeBytes,
        gpsLocation: worldcoinProof.gps_location,
        consentToStoreImage,
        consentScope: consentScope || "ethglobal_hackathon",
        provenancePayload: payload,
      });
      console.log(`[submit-image] ✓ image persisted to db record_id=${imageRecordId}`);
    } catch (dbErr) {
      console.error("[submit-image] failed to persist image to db:", dbErr);
      return NextResponse.json({ error: "Failed to store image in database", detail: String(dbErr) }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      image_record_id: imageRecordId,
      bypassed: verificationBypassed,
      bypass_reason: verificationBypassed ? "invalid_action" : undefined,
      session_id: verification.session_id,
      nullifier_hash: nullifier,
      verification_level: verificationLevel,
      payload,
      verification_environment: verification.environment,
      verification_detail: verification.detail,
    });
  } catch (err) {
    console.error("[submit-image] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
