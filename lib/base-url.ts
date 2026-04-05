import { headers } from "next/headers";

export async function resolveBaseUrl(): Promise<string> {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (configured) return configured.replace(/\/$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}
