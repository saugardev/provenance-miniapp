/**
 * POST /api/rp-signature
 *
 * Returns a short-lived RP (Relying Party) signature that the frontend passes
 * to IDKit as `rp_context`. The signing key never leaves the server.
 *
 * Why this exists:
 *   World ID requires the RP to prove it authorized the request by signing
 *   the action with the private key registered in the Developer Portal.
 *   The frontend calls this endpoint first, then passes the returned context
 *   to IDKit.request({ rp_context: ... }).
 *
 *
 * Request:  { action: string, ttl_seconds?: number }
 *            ttl_seconds: RP signature lifetime (default 300). Clamped 300–900.
 *            Use 900 for orbLegacy (v3) flows — proof generation can exceed 5 minutes.
 * Response: { sig, nonce, created_at, expires_at, rp_id }
 */

import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { resolveWorldcoinRpId } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  console.log("[rp-signature] request received");
  try {
    const body = await request.json().catch(() => ({}));
    const { action, ttl_seconds: ttlRaw } = body as { action?: string; ttl_seconds?: number };
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
    // signRequest(action, signingKey, ttlSeconds) — ECDSA over RP message (see @worldcoin/idkit-server)
    const ttl =
      Number.isFinite(ttlRaw) && ttlRaw! > 0
        ? Math.min(900, Math.max(300, Math.floor(ttlRaw as number)))
        : 300;
    const { sig, nonce, createdAt, expiresAt } = signRequest(action, signingKey, ttl);

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
