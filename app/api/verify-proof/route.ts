import { NextResponse } from "next/server";
import { verifyIdKitResponseFlexible } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type VerifyProofBody = {
  idkitResponse?: unknown;
  hints?: {
    action?: string;
    signal?: string;
    nonce?: string;
  };
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyProofBody;
    if (!body?.idkitResponse) {
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }

    const raw = body.idkitResponse as any;
    const actionHint = String(body?.hints?.action ?? "").trim();
    const signalHint = String(body?.hints?.signal ?? "").trim();
    const nonceHint = String(body?.hints?.nonce ?? "").trim();
    const withHints =
      raw && typeof raw === "object"
        ? {
            ...raw,
            action: String(raw?.action ?? (actionHint || "upload_photo")),
            signal: String(raw?.signal ?? signalHint),
            nonce: String(raw?.nonce ?? nonceHint),
          }
        : raw;

    const verification = await verifyIdKitResponseFlexible(withHints);
    const status = verification.success ? 200 : 401;
    return NextResponse.json(
      {
        success: verification.success,
        environment: verification.environment,
        session_id: verification.session_id,
        detail: verification.detail,
        used_payload: verification.used_payload,
        parsed: verification.parsed,
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
