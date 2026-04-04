import { NextResponse } from "next/server";
import { verifyCloudProof, type IVerifyResponse, type ISuccessResult } from "@worldcoin/minikit-js";

export const runtime = "nodejs";

type VerifyProofBody = {
  payload?: ISuccessResult;
  action?: string;
  signal?: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyProofBody;
    if (!body?.payload) {
      return NextResponse.json({ error: "payload is required" }, { status: 400 });
    }
    const action = String(body?.action ?? "").trim();
    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    const signal = body?.signal ? String(body.signal).trim() : undefined;
    const appIdRaw = String(process.env.APP_ID ?? process.env.WORLDCOIN_APP_ID ?? process.env.WORLDCOIN_RP_ID ?? "").trim();
    if (!appIdRaw.startsWith("app_")) {
      return NextResponse.json({ error: "APP_ID (app_...) is required for MiniKit cloud verification" }, { status: 500 });
    }
    const appId = appIdRaw as `app_${string}`;

    const verifyRes = (await verifyCloudProof(body.payload, appId, action, signal)) as IVerifyResponse;
    const status = verifyRes.success ? 200 : 401;
    return NextResponse.json(
      {
        success: verifyRes.success,
        detail: verifyRes,
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
