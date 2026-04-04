import { NextResponse } from "next/server";
import type { ISuccessResult } from "@worldcoin/minikit-js";
import { verifyWorldcoinProof } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type VerifyProofBody = {
  payload?: ISuccessResult;
  action?: string;
  signal?: string;
  nonce?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyProofBody;
    if (!body?.payload) {
      return NextResponse.json({ error: "payload is required" }, { status: 400 });
    }
    const configuredAction = String(process.env.WORLDCOIN_ACTION ?? "").trim();
    const action = String(body?.action ?? configuredAction).trim();
    if (!action) {
      return NextResponse.json({ error: "action is required (set WORLDCOIN_ACTION or send action)" }, { status: 400 });
    }
    const signal = body?.signal ? String(body.signal).trim() : undefined;
    const nonceHint = String(body?.nonce ?? "").trim();
    const verifyRes = await verifyWorldcoinProof({
      action,
      signal,
      proof: String(body.payload.proof ?? ""),
      merkle_root: String(body.payload.merkle_root ?? ""),
      nullifier_hash: String(body.payload.nullifier_hash ?? ""),
      verification_level: String(body.payload.verification_level ?? ""),
      nonce: String((body.payload as any).nonce ?? nonceHint),
    });
    const status = verifyRes.success ? 200 : 401;
    return NextResponse.json(
      {
        success: verifyRes.success,
        action,
        detail: verifyRes.detail,
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
