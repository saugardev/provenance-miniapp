export type VerifyResult = {
  success: boolean;
  detail?: unknown;
  environment?: string;
  session_id?: string;
};

export function resolveWorldcoinRpId(): string {
  const raw = String(process.env.WORLDCOIN_RP_ID ?? "").trim();
  if (!raw) {
    throw new Error("WORLDCOIN_RP_ID is required (rp_... from World Developer Portal)");
  }
  if (raw.startsWith("rp_") || raw.startsWith("app_")) return raw;
  throw new Error("WORLDCOIN_RP_ID must start with rp_ (preferred) or app_ (legacy)");
}

/**
 * Forwards the raw IDKitResult to the World ID verify API.
 * Per docs: "Forward the IDKit result payload as-is. No field remapping is required."
 * https://docs.world.org/world-id/idkit/integrate
 */
export async function verifyIdKitResponse(idkitResponse: unknown): Promise<VerifyResult> {
  const rpId = resolveWorldcoinRpId();
  const apiBase = process.env.WORLDCOIN_VERIFY_BASE_URL ?? "https://developer.world.org";

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.WORLDCOIN_API_KEY) {
    headers.authorization = `Bearer ${process.env.WORLDCOIN_API_KEY}`;
  }

  const resp = await fetch(`${apiBase}/api/v4/verify/${rpId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(idkitResponse),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { success: false, detail: { status: resp.status, body } };
  }

  return {
    success: body?.success === true,
    detail: body,
    environment: body?.environment,
    session_id: body?.session_id,
  };
}

/**
 * Extracts proof fields from an IDKitResult for downstream payload building.
 * Handles both protocol v3 (nullifier + merkle_root) and v4 (nullifier only).
 */
export function extractIdkitFields(result: unknown): {
  nullifier: string;
  verificationLevel: string;
  merkleRoot: string;
} {
  const r = result as any;
  const res0 = Array.isArray(r?.responses) ? r.responses[0] : undefined;
  return {
    nullifier: String(res0?.nullifier ?? "").trim(),
    verificationLevel: String(res0?.identifier ?? "").trim(),
    merkleRoot: String(res0?.merkle_root ?? "").trim(), // v3 only; empty for v4
  };
}
