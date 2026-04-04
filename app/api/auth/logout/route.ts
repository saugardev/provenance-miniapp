import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("miniapp_wallet");
  response.cookies.delete("siwe");
  return response;
}
