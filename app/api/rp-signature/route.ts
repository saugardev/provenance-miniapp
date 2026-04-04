/**
 * POST /api/rp-signature
 *
 * Returns a short-lived RP (Relying Party) signature that the frontend passes
 * to IDKit as `rp_context`. The signing key never leaves the server.
 *
 * Why this exists:
 *   World ID 4 requires the RP to prove it authorized the request by signing
 *   the action with the private key registered in the Developer Portal.
 *   The frontend calls this endpoint first, then passes the returned context
 *   to IDKit.request({ rp_context: ... }).
 *
 * Docs: https://docs.world.org/world-id/idkit/advanced#rp-context--request-signing
 *
 * Request:  { action: string }
 * Response: { sig, nonce, created_at, expires_at, rp_id }
 */

import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { resolveWorldcoinRpId } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  console.log("[rp-signature] request received");
  try {
    const { action } = await request.json().catch(() => ({}));
    if (!action) {
      console.warn("[rp-signature] missing action in request body");
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const signingKey = process.env.RP_SIGNING_KEY?.trim() ?? "";
    if (!signingKey) {
      console.error("[rp-signature] RP_SIGNING_KEY is not configured");
      return NextResponse.json({ error: "RP_SIGNING_KEY is not configured" }, { status: 500 });
    }

    const rpId = resolveWorldcoinRpId();
    // signRequest(action, signingKey) → { sig, nonce, createdAt, expiresAt }
    // sig is an HMAC-SHA256 over "action:nonce:createdAt" using the RP signing key
    const { sig, nonce, createdAt, expiresAt } = signRequest(action, signingKey);

    console.log(`[rp-signature] signed action="${action}" rp_id="${rpId}" nonce="${nonce}" expires_at=${expiresAt}`);
    return NextResponse.json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      rp_id: rpId,
    });
  } catch (err) {
    console.error("[rp-signature] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
