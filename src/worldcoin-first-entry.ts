import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

export type WorldSignature = {
  algorithm: "ed25519";
  message: string;
  signature_b64: string;
  public_key_pem: string;
};

export type WorldcoinProof = {
  proof_status: "verified" | "failed";
  nullifier_hash: string;
  miniapp_session_id: string;
  merkle_root: string;
  verification_level: string;
  version?: number;
  action: string;
  signal?: string;
};

export type WorldcoinFirstEntryPayload = {
  description: string;
  mode: "dev" | "build";
  timestamp_ms: number;
  entry: {
    content_id: string;
    content_hash: string;
  };
  worldcoin_proof: WorldcoinProof;
  world_signature: WorldSignature;
  signature: string;
  signature_algorithm: string;
  relation_markers: string[];
  livy_public_values: {
    entries: unknown[];
    public_values_b64: string;
    public_values_commitment_hash_hex: string;
    report_data_payload_hash_hex: string;
  };
  next_step_hint: string;
};

export type BuildEntryInput = {
  mode: "dev" | "build";
  timestamp_ms: number;
  content_id: string;
  content_hash: string;
  worldcoin_proof: WorldcoinProof;
};

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function wirePublicValues(entries: readonly unknown[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = jsonBytes(entry);
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeUInt32LE(bytes.length, 0);
    chunks.push(lengthPrefix, bytes);
  }
  return Buffer.concat(chunks);
}

export function canonicalMessage(parts: {
  content_hash: string;
  content_id: string;
  nullifier_hash: string;
  action: string;
  signal?: string;
  timestamp_ms: number;
}): string {
  return [
    "livy-worldcoin-v1",
    parts.content_hash,
    parts.nullifier_hash,
    parts.action,
    parts.signal ?? "",
    String(parts.timestamp_ms),
    parts.content_id,
  ].join("|");
}

export function makeWorldSignature(message: string, privateKeyPem: string, publicKeyPem: string): WorldSignature {
  const sig = cryptoSign(null, Buffer.from(message, "utf8"), privateKeyPem);
  return {
    algorithm: "ed25519",
    message,
    signature_b64: sig.toString("base64"),
    public_key_pem: publicKeyPem,
  };
}

export function verifyWorldSignature(sig: WorldSignature): boolean {
  return cryptoVerify(
    null,
    Buffer.from(sig.message, "utf8"),
    sig.public_key_pem,
    Buffer.from(sig.signature_b64, "base64"),
  );
}

export function buildWorldcoinFirstEntry(
  input: BuildEntryInput,
  keyMaterial: { privateKeyPem: string; publicKeyPem: string },
): WorldcoinFirstEntryPayload {
  const relationMarkers = [
    `worldid:session:${input.worldcoin_proof.miniapp_session_id}`,
    `worldid:nullifier:${input.worldcoin_proof.nullifier_hash}`,
    `worldid:proof_status:${input.worldcoin_proof.proof_status}`,
    `worldid:verification_level:${input.worldcoin_proof.verification_level}`,
  ];

  const publicValuesEntries: unknown[] = [
    input.content_id,
    input.content_hash,
    `did:world:nullifier:${input.worldcoin_proof.nullifier_hash}`,
    "sig:worldid:ed25519",
    "ed25519:worldid:v1",
    ...relationMarkers,
    input.timestamp_ms,
  ];

  const publicValuesWire = wirePublicValues(publicValuesEntries);
  const commitment = sha256Hex(publicValuesWire);

  const message = canonicalMessage({
    content_hash: input.content_hash,
    content_id: input.content_id,
    nullifier_hash: input.worldcoin_proof.nullifier_hash,
    action: input.worldcoin_proof.action,
    signal: input.worldcoin_proof.signal,
    timestamp_ms: input.timestamp_ms,
  });
  const worldSig = makeWorldSignature(message, keyMaterial.privateKeyPem, keyMaterial.publicKeyPem);

  return {
    description: "Worldcoin first-entry payload signed by backend for Livy provenance ingestion.",
    mode: input.mode,
    timestamp_ms: input.timestamp_ms,
    entry: {
      content_id: input.content_id,
      content_hash: input.content_hash,
    },
    worldcoin_proof: input.worldcoin_proof,
    world_signature: worldSig,
    signature: worldSig.signature_b64,
    signature_algorithm: "ed25519:worldid:v1",
    relation_markers: relationMarkers,
    livy_public_values: {
      entries: publicValuesEntries,
      public_values_b64: publicValuesWire.toString("base64"),
      public_values_commitment_hash_hex: commitment,
      report_data_payload_hash_hex: commitment,
    },
    next_step_hint: "Send this payload to livy-example import, then pass through livy-tee for attested provenance.",
  };
}
