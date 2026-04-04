import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";
import { resolveWorldcoinRpId } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type RpSignatureBody = {
  action?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as RpSignatureBody;
    const action = String(body?.action ?? "").trim();
    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const signingKey = String(process.env.RP_SIGNING_KEY ?? "").trim();
    if (!signingKey) {
      return NextResponse.json({ error: "RP_SIGNING_KEY is required" }, { status: 500 });
    }

    const rpId = resolveWorldcoinRpId();
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
