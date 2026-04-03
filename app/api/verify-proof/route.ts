import { NextResponse } from "next/server";
import { verifyIdKitResponse } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type VerifyProofBody = {
  idkitResponse?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyProofBody;
    if (!body?.idkitResponse) {
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }

    const verification = await verifyIdKitResponse(body.idkitResponse);
    const status = verification.success ? 200 : 401;
    return NextResponse.json(
      {
        success: verification.success,
        environment: verification.environment,
        session_id: verification.session_id,
        detail: verification.detail,
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
