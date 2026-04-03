import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: ((process.env.WORLDCOIN_MODE ?? "dev").toLowerCase() === "build" ? "build" : "dev"),
    worldcoin_rp_id_set: Boolean(process.env.WORLDCOIN_RP_ID),
  });
}
