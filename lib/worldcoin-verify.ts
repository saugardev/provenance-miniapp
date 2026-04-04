/**
 * World ID proof verification helpers.
 *
 * Verification flow (v3 orbLegacy):
 *   1. Frontend calls IDKit.request() → World App generates a ZK proof.
 *   2. Frontend forwards the raw IDKitResult to POST /api/verify-proof.
 *   3. Backend forwards it as-is to the World ID Developer API.
 *   4. On success, backend extracts fields for payload building.
 *
 * Docs:
 *   Integrate IDKit:     https://docs.world.org/world-id/idkit/integrate
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type VerifyResult = {
  success: boolean;
  detail?: unknown;
  environment?: string;
  session_id?: string;
};

/**
 * Reads and validates WORLDCOIN_RP_ID from env.
 * Must start with `rp_` or `app_`.
 * Obtain from https://developer.world.org → your app → "Relying Party".
 */
export function resolveWorldcoinRpId(): string {
  const raw = String(process.env.WORLDCOIN_RP_ID ?? "").trim();
  if (!raw) {
    throw new Error("WORLDCOIN_RP_ID is required (rp_... from World Developer Portal)");
  }
  if (raw.startsWith("rp_") || raw.startsWith("app_")) return raw;
  throw new Error("WORLDCOIN_RP_ID must start with rp_ (preferred) or app_ (legacy)");
}

// ---------------------------------------------------------------------------
// Proof verification — World ID Developer API
// ---------------------------------------------------------------------------

/**
 * Forwards the raw IDKitResult to the World ID verify API and returns success/failure.
 *
 * "Forward the IDKit result payload as-is. No field remapping is required."
 *
 * For v3, the caller must inject `action` into the payload before calling this
 * because orbLegacy results may omit it (see /api/verify-proof and /api/submit-image).
 */
export async function verifyIdKitResponse(idkitResponse: unknown): Promise<VerifyResult> {
  const rpId = resolveWorldcoinRpId();
  const apiBase = process.env.WORLDCOIN_VERIFY_BASE_URL ?? "https://developer.world.org";

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.WORLDCOIN_API_KEY) {
    // Optional: set in World Developer Portal for higher rate limits
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

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the fields needed for attestation building from an IDKitResult.
 *
 * IDKitResult shape:
 *   { responses: [{ nullifier, identifier, merkle_root? }], ... }
 *
 * v3 (orbLegacy): responses[0].merkle_root is populated (on-chain anchor).
 *
 * Docs: https://docs.world.org/world-id/idkit/reference#idkitresult
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
    merkleRoot: String(res0?.merkle_root ?? "").trim(),
  };
}
