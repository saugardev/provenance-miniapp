import { NextResponse } from "next/server";
import { canonicalMessage, verifyWorldSignature, type WorldcoinFirstEntryPayload } from "../../../src/worldcoin-first-entry.ts";
import { publishPayloadTo0g } from "../../../src/og-storage.ts";

export const runtime = "nodejs";

type PublishOgBody = {
  signed_payload?: unknown;
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
  console.log("[publish-og] request received");
  try {
    const body = (await req.json()) as PublishOgBody;
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

    const ogStorage = await publishPayloadTo0g({
      payload,
      nullifierHash: payload.worldcoin_proof.nullifier_hash,
      action: payload.worldcoin_proof.action,
      contentId: payload.entry.content_id,
    });

    return NextResponse.json({
      ok: true,
      submitted_to_og: ogStorage.published,
      og_storage: ogStorage,
    });
  } catch (err) {
    console.error("[publish-og] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
