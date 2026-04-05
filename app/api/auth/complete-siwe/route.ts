import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MiniAppWalletAuthSuccessPayload } from "@worldcoin/minikit-js";
import { verifySiweMessage } from "@worldcoin/minikit-js";
import {
  MINIAPP_SESSION_MAX_AGE_SECONDS,
  MINIAPP_WALLET_COOKIE,
  MINIAPP_WALLET_EXPIRES_COOKIE,
  SIWE_NONCE_COOKIE,
} from "../../../../lib/auth-session";

export const runtime = "nodejs";

const SIWE_STATEMENT = "Sign in to Prove Reality";

type RequestBody = {
  payload?: MiniAppWalletAuthSuccessPayload;
  nonce?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const payload = body?.payload;
    const nonce = String(body?.nonce ?? "");
    const cookieStore = await cookies();
    const nonceCookie = cookieStore.get("siwe")?.value;

    if (!payload || !nonce) {
      return NextResponse.json({ isValid: false, error: "Missing payload or nonce" }, { status: 400 });
    }
    if (!nonceCookie || nonceCookie !== nonce) {
      return NextResponse.json({ isValid: false, error: "Invalid nonce" }, { status: 400 });
    }

    const verification = await verifySiweMessage(payload, nonce, SIWE_STATEMENT);
    if (!verification?.isValid) {
      return NextResponse.json({ isValid: false, error: "SIWE verification failed" }, { status: 400 });
    }

    const address = verification.siweMessageData.address;
    if (!address) {
      return NextResponse.json({ isValid: false, error: "Missing address in SIWE message" }, { status: 400 });
    }
    const response = NextResponse.json({ isValid: true, address });
    const expiresAtMs = Date.now() + MINIAPP_SESSION_MAX_AGE_SECONDS * 1000;
    response.cookies.delete(SIWE_NONCE_COOKIE);
    response.cookies.set(MINIAPP_WALLET_COOKIE, address, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: MINIAPP_SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
    response.cookies.set(MINIAPP_WALLET_EXPIRES_COOKIE, String(expiresAtMs), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: MINIAPP_SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { isValid: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
