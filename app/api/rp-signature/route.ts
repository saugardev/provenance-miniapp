import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { resolveWorldcoinRpId } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const { action } = await request.json().catch(() => ({}));
    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const signingKey = process.env.RP_SIGNING_KEY?.trim() ?? "";
    if (!signingKey) {
      return NextResponse.json({ error: "RP_SIGNING_KEY is not configured" }, { status: 500 });
    }

    const rpId = resolveWorldcoinRpId();
    // signRequest returns { sig, nonce, createdAt, expiresAt }
    const { sig, nonce, createdAt, expiresAt } = signRequest(action, signingKey);

    return NextResponse.json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      rp_id: rpId,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
