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

import { hashSignal } from "@worldcoin/idkit/hashing";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type VerifyResult = {
  success: boolean;
  detail?: unknown;
  environment?: string;
  session_id?: string;
};

export type MiniAppProof = {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
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

/**
 * Reads and validates the World App ID from env.
 * The frontend uses NEXT_PUBLIC_WORLDCOIN_APP_ID; the backend can read either.
 */
export function resolveWorldcoinAppId(): `app_${string}` {
  const raw = String(process.env.WORLDCOIN_APP_ID ?? process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "").trim();
  if (!raw) {
    throw new Error("WORLDCOIN_APP_ID or NEXT_PUBLIC_WORLDCOIN_APP_ID is required (must start with app_)");
  }
  if (raw.startsWith("app_")) return raw as `app_${string}`;
  throw new Error("World App ID must start with app_");
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

/**
 * Verifies a MiniKit proof against the World mini-app verification API.
 */
export async function verifyMiniAppProof(
  proof: MiniAppProof,
  action: string,
  signal: string,
): Promise<VerifyResult> {
  const appId = resolveWorldcoinAppId();
  const apiBase =
    process.env.WORLDCOIN_MINIAPP_VERIFY_BASE_URL ??
    process.env.WORLDCOIN_VERIFY_BASE_URL ??
    "https://developer.worldcoin.org";

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.WORLDCOIN_API_KEY) {
    headers.authorization = `Bearer ${process.env.WORLDCOIN_API_KEY}`;
  }

  const resp = await fetch(`${apiBase}/api/v2/verify/${appId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...proof,
      action,
      signal_hash: hashSignal(signal),
    }),
  });

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { success: false, detail: { status: resp.status, body } };
  }

  return {
    success: body?.success !== false,
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

export function isMiniAppProof(value: unknown): value is MiniAppProof {
  const candidate = value as MiniAppProof | null | undefined;
  return Boolean(
    candidate &&
      typeof candidate.proof === "string" &&
      typeof candidate.merkle_root === "string" &&
      typeof candidate.nullifier_hash === "string" &&
      typeof candidate.verification_level === "string",
  );
}

export function extractMiniAppFields(result: MiniAppProof): {
  nullifier: string;
  verificationLevel: string;
  merkleRoot: string;
} {
  return {
    nullifier: String(result.nullifier_hash ?? "").trim(),
    verificationLevel: String(result.verification_level ?? "").trim(),
    merkleRoot: String(result.merkle_root ?? "").trim(),
  };
}

export function shouldBypassInvalidAction(detail: unknown): boolean {
  if (process.env.WORLDCOIN_ALLOW_INVALID_ACTION_BYPASS !== "true") {
    return false;
  }

  const candidate = detail as { status?: unknown; body?: { code?: unknown } } | null | undefined;
  return Number(candidate?.status) === 400 && String(candidate?.body?.code ?? "").trim() === "invalid_action";
}
