import { NextResponse } from "next/server";
import { verifyIdKitResponse } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const idkitResponse = body?.idkitResponse ?? body?.idkit_result;
    if (!idkitResponse) {
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }

    const configuredAction = process.env.WORLDCOIN_ACTION?.trim() ?? "";
    const action = String(idkitResponse?.action ?? configuredAction).trim();

    // Inject action if absent — orbLegacy (v3) results may omit it
    const payload = action ? { ...idkitResponse, action } : idkitResponse;

    const result = await verifyIdKitResponse(payload);
    return NextResponse.json(
      { success: result.success, detail: result.detail },
      { status: result.success ? 200 : 401 },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
