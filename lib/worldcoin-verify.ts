export type VerifyWorldcoinInput = {
  action: string;
  signal?: string;
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  nonce?: string;
};

export type VerifyWorldcoinResult = {
  success: boolean;
  detail?: unknown;
  environment?: string;
  session_id?: string;
};

export function resolveWorldcoinRpId(): string {
  const raw = String(process.env.WORLDCOIN_RP_ID ?? "").trim();
  if (!raw) {
    throw new Error("WORLDCOIN_RP_ID is required (expected rp_... from World Developer Portal)");
  }
  if (raw.startsWith("rp_")) return raw;
  if (raw.startsWith("app_")) {
    console.warn("[worldcoin-miniapp] WORLDCOIN_RP_ID is using app_... (legacy compatible). Prefer rp_... for World ID 4.0.");
    return raw;
  }
  throw new Error("WORLDCOIN_RP_ID must start with rp_ (preferred) or app_ (legacy)");
}

export async function verifyWorldcoinProof(input: VerifyWorldcoinInput): Promise<VerifyWorldcoinResult> {
  const rpId = resolveWorldcoinRpId();
  const apiBase = process.env.WORLDCOIN_VERIFY_BASE_URL ?? "https://developer.world.org";
  const url = `${apiBase}/api/v4/verify/${rpId}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.WORLDCOIN_API_KEY) {
    headers.authorization = `Bearer ${process.env.WORLDCOIN_API_KEY}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: input.action,
      signal: input.signal,
      protocol_version: "3.0",
      responses: [
        {
          protocol_version: "3.0",
          proof: input.proof,
          merkle_root: input.merkle_root,
          nullifier: input.nullifier_hash,
          identifier: input.verification_level,
          nonce: input.nonce,
        },
      ],
    }),
  });

  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { success: false, detail: { status: resp.status, payload } };
  }

  return {
    success: payload?.success === true,
    detail: payload,
    environment: payload?.environment,
    session_id: payload?.session_id,
  };
}

export async function verifyIdKitResponse(idkitResponse: unknown): Promise<VerifyWorldcoinResult> {
  const rpId = resolveWorldcoinRpId();
  const apiBase = process.env.WORLDCOIN_VERIFY_BASE_URL ?? "https://developer.world.org";
  const url = `${apiBase}/api/v4/verify/${rpId}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.WORLDCOIN_API_KEY) {
    headers.authorization = `Bearer ${process.env.WORLDCOIN_API_KEY}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(idkitResponse),
  });

  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { success: false, detail: { status: resp.status, payload } };
  }

  return {
    success: payload?.success === true,
    detail: payload,
    environment: payload?.environment,
    session_id: payload?.session_id,
  };
}
