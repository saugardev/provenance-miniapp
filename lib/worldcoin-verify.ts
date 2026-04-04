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
  used_payload?: unknown;
  parsed?: {
    action: string;
    signal?: string;
    proof: string;
    merkle_root: string;
    nullifier_hash: string;
    verification_level: string;
    nonce?: string;
  };
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
    used_payload: idkitResponse,
  };
}

type ParsedLike = {
  action: string;
  signal?: string;
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  nonce?: string;
};

function parseAnyIdkitLike(input: any): ParsedLike | null {
  if (!input || typeof input !== "object") return null;
  const top = input;
  const response0 = Array.isArray(top?.responses) ? top.responses[0] : undefined;

  const proof = String(top?.proof ?? response0?.proof ?? "").trim();
  const merkle_root = String(top?.merkle_root ?? response0?.merkle_root ?? "").trim();
  const nullifier_hash = String(top?.nullifier_hash ?? response0?.nullifier ?? response0?.nullifier_hash ?? "").trim();
  const action = String(top?.action ?? "").trim();
  const signal = String(top?.signal ?? response0?.signal ?? "").trim() || undefined;
  const verification_level = String(top?.verification_level ?? response0?.identifier ?? "").trim();
  const nonce = String(top?.nonce ?? response0?.nonce ?? "").trim() || undefined;

  if (!proof || !merkle_root || !nullifier_hash || !action) return null;

  return {
    action,
    signal,
    proof,
    merkle_root,
    nullifier_hash,
    verification_level: verification_level || "orb",
    nonce,
  };
}

function normalizeParsedToIdkitResponse(parsed: ParsedLike): unknown {
  return {
    action: parsed.action,
    signal: parsed.signal,
    protocol_version: "3.0",
    responses: [
      {
        protocol_version: "3.0",
        proof: parsed.proof,
        merkle_root: parsed.merkle_root,
        nullifier: parsed.nullifier_hash,
        identifier: parsed.verification_level,
        nonce: parsed.nonce,
      },
    ],
  };
}

export async function verifyIdKitResponseFlexible(raw: unknown): Promise<VerifyWorldcoinResult> {
  const anyRaw = raw as any;
  const candidates: unknown[] = [];

  const push = (value: unknown) => {
    if (value == null) return;
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(value);
    }
  };
  const seen = new Set<string>();

  push(anyRaw);
  push(anyRaw?.finalPayload);
  push(anyRaw?.payload);

  const parsedDirect = parseAnyIdkitLike(anyRaw);
  if (parsedDirect) push(normalizeParsedToIdkitResponse(parsedDirect));

  const parsedFinal = parseAnyIdkitLike(anyRaw?.finalPayload);
  if (parsedFinal) push(normalizeParsedToIdkitResponse(parsedFinal));

  const parsedPayload = parseAnyIdkitLike(anyRaw?.payload);
  if (parsedPayload) push(normalizeParsedToIdkitResponse(parsedPayload));

  let last: VerifyWorldcoinResult = { success: false, detail: { error: "no_valid_idkit_candidate" } };
  for (const candidate of candidates) {
    const result = await verifyIdKitResponse(candidate);
    if (result.success) {
      const parsed = parseAnyIdkitLike(candidate as any) ?? undefined;
      return {
        ...result,
        used_payload: candidate,
        parsed,
      };
    }
    last = result;
  }

  return last;
}
