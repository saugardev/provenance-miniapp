import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const address = cookieStore.get("miniapp_wallet")?.value ?? null;
  return NextResponse.json({
    authenticated: Boolean(address),
    address,
  });
}
