import { NextResponse } from "next/server";
import { verifyIdKitResponse } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type VerifyProofBody = {
  idkit_result?: unknown;
  action?: string;
  signal?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyProofBody;
    if (!body?.idkit_result) {
      return NextResponse.json({ error: "idkit_result is required" }, { status: 400 });
    }
    const configuredAction = String(process.env.WORLDCOIN_ACTION ?? "").trim();
    const action = String((body.idkit_result as any)?.action ?? body?.action ?? configuredAction).trim();

    // Ensure action is always present in the payload sent to World API
    const idkitPayload = action
      ? { ...(body.idkit_result as object), action }
      : body.idkit_result;

    const verifyRes = await verifyIdKitResponse(idkitPayload);
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
