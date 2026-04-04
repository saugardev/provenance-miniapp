import { NextResponse } from "next/server";
import { canonicalMessage, sha256Hex, verifyWorldSignature, type WorldcoinFirstEntryPayload } from "../../../src/worldcoin-first-entry.ts";
import { persistUploadedImage } from "../../../src/image-store.ts";

export const runtime = "nodejs";

type UploadBody = {
  signed_payload?: unknown;
  consent_to_store_image?: boolean;
  consent_scope?: string;
  image_base64?: string;
  image_mime_type?: string;
  image_file_name?: string;
  image_size_bytes?: number;
};

function isSignedPayload(value: unknown): value is WorldcoinFirstEntryPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  return (
    typeof v?.entry?.content_id === "string"
    && typeof v?.entry?.content_hash === "string"
    && typeof v?.worldcoin_proof?.nullifier_hash === "string"
    && typeof v?.worldcoin_proof?.action === "string"
    && typeof v?.world_signature?.message === "string"
    && typeof v?.world_signature?.signature_b64 === "string"
    && typeof v?.world_signature?.public_key_pem === "string"
  );
}

export async function POST(req: Request) {
  console.log("[upload-image] request received");
  try {
    const body = (await req.json()) as UploadBody;
    const consentToStoreImage = body?.consent_to_store_image !== false;
    const consentScope = String(body?.consent_scope ?? "ethglobal_hackathon").trim() || "ethglobal_hackathon";
    const imageBase64 = String(body?.image_base64 ?? "").trim();
    const imageMimeType = String(body?.image_mime_type ?? "").trim() || "application/octet-stream";
    const imageFileName = String(body?.image_file_name ?? "").trim() || null;
    const imageSizeBytes = Number.isFinite(Number(body?.image_size_bytes)) ? Number(body?.image_size_bytes) : 0;

    if (!consentToStoreImage) {
      return NextResponse.json({ error: "Storage consent was denied by the user." }, { status: 403 });
    }
    if (!imageBase64) {
      return NextResponse.json({ error: "image_base64 is required for upload" }, { status: 400 });
    }
    if (!imageSizeBytes || imageSizeBytes <= 0) {
      return NextResponse.json({ error: "image_size_bytes must be greater than 0" }, { status: 400 });
    }
    if (!isSignedPayload(body?.signed_payload)) {
      return NextResponse.json({ error: "signed_payload is required" }, { status: 400 });
    }

    const payload = body.signed_payload;
    const signatureOk = verifyWorldSignature(payload.world_signature);
    if (!signatureOk) {
      return NextResponse.json({ error: "Invalid backend signature in signed_payload" }, { status: 401 });
    }

    const expectedMessage = canonicalMessage({
      content_hash: payload.entry.content_hash,
      content_id: payload.entry.content_id,
      nullifier_hash: payload.worldcoin_proof.nullifier_hash,
      action: payload.worldcoin_proof.action,
      signal: payload.worldcoin_proof.signal,
      gps_latitude: payload.worldcoin_proof.gps_location?.latitude,
      gps_longitude: payload.worldcoin_proof.gps_location?.longitude,
      gps_captured_at_ms: payload.worldcoin_proof.gps_location?.captured_at_ms,
      timestamp_ms: payload.timestamp_ms,
    });
    if (expectedMessage !== payload.world_signature.message) {
      return NextResponse.json({ error: "signed_payload world_signature.message mismatch" }, { status: 400 });
    }

    const imageBytes = Buffer.from(imageBase64, "base64");
    if (!imageBytes.length) {
      return NextResponse.json({ error: "Decoded image bytes are empty" }, { status: 400 });
    }
    const recomputedHash = `sha256:${sha256Hex(imageBytes)}`;
    if (recomputedHash !== payload.entry.content_hash) {
      return NextResponse.json(
        { error: "Uploaded image hash does not match signed payload content_hash" },
        { status: 400 },
      );
    }

    if (payload.worldcoin_proof.signal !== payload.entry.content_hash) {
      return NextResponse.json(
        { error: "signed_payload signal is not bound to content_hash" },
        { status: 400 },
      );
    }

    const imageRecordId = await persistUploadedImage({
      contentId: payload.entry.content_id,
      contentHash: payload.entry.content_hash,
      action: payload.worldcoin_proof.action,
      nullifierHash: payload.worldcoin_proof.nullifier_hash,
      verificationLevel: payload.worldcoin_proof.verification_level,
      merkleRoot: payload.worldcoin_proof.merkle_root,
      imageBase64,
      imageMimeType,
      imageFileName,
      imageSizeBytes,
      gpsLocation: payload.worldcoin_proof.gps_location,
      consentToStoreImage,
      consentScope,
      provenancePayload: payload,
    });

    return NextResponse.json({
      ok: true,
      uploaded: true,
      image_record_id: imageRecordId,
      payload,
    });
  } catch (err) {
    console.error("[upload-image] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
