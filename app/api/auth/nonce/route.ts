import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

function generateNonce(length = 20): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length * 2);
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
    if (out.length >= length) break;
  }
  return out;
}

export async function GET() {
  const nonce = generateNonce(24);
  const response = NextResponse.json({ nonce });
  response.cookies.set("siwe", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 5,
    path: "/",
  });
  return response;
}
