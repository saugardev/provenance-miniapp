import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearMiniAppWalletCookies, readMiniAppWalletSession } from "../../../../lib/auth-session";

export async function GET() {
  const cookieStore = await cookies();
  const session = readMiniAppWalletSession(cookieStore);
  const response = NextResponse.json({
    authenticated: Boolean(session.walletAddress),
    address: session.walletAddress,
    expires_at_ms: session.expiresAtMs,
  });
  if (session.expired) {
    clearMiniAppWalletCookies(response.cookies);
  }
  return response;
}
