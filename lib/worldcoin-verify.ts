/**
 * World ID proof verification helpers.
 *
 * Verification flow (both v3 and v4):
 *   1. Frontend calls IDKit.request() → World App generates a ZK proof.
 *   2. Frontend forwards the raw IDKitResult to POST /api/verify-proof.
 *   3. Backend forwards it as-is to the World ID Developer API.
 *   4. On success, backend extracts fields for payload building.
 *
 * Protocol differences:
 *   - v3 (orbLegacy)  — IDKitResult contains merkle_root; `action` may be absent.
 *   - v4 (World ID 4) — IDKitResult has no merkle_root; `action` always present.
 *   Both are verified via the same endpoint; the API accepts either shape.
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
 * Must start with `rp_` (World ID 4) or `app_` (legacy orb).
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
 * Works for both v3 (orbLegacy) and v4 proofs.
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
// Field extraction — v3 vs v4 normalization
// ---------------------------------------------------------------------------

/**
 * Extracts the fields needed for attestation building from an IDKitResult.
 *
 * IDKitResult shape (both versions):
 *   { responses: [{ nullifier, identifier, merkle_root? }], ... }
 *
 * v3 (orbLegacy): responses[0].merkle_root is populated (on-chain anchor).
 * v4 (World ID 4): responses[0].merkle_root is absent → returns empty string.
 *
 * Docs: https://docs.world.org/world-id/idkit/reference#idkitresult
 */
export function extractIdkitFields(result: unknown): {
  nullifier: string;
  verificationLevel: string;
  merkleRoot: string; // populated for v3; empty string for v4
} {
  const r = result as any;
  const res0 = Array.isArray(r?.responses) ? r.responses[0] : undefined;
  return {
    nullifier: String(res0?.nullifier ?? "").trim(),
    verificationLevel: String(res0?.identifier ?? "").trim(),
    merkleRoot: String(res0?.merkle_root ?? "").trim(),
  };
}
