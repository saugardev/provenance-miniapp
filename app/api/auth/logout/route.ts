import { NextResponse } from "next/server";
import { clearMiniAppWalletCookies } from "../../../../lib/auth-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearMiniAppWalletCookies(response.cookies);
  return response;
}
