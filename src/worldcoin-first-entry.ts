/**
 * Livy provenance attestation builder.
 *
 * After a World ID proof is verified, this module builds a signed payload
 * that Livy can ingest as a "first-entry" provenance record. The payload
 * binds a content hash to a verified World ID nullifier via an ED25519
 * signature produced by this backend's own keypair.
 *
 * Signing algorithm: ED25519 (Node.js built-in crypto, PKCS8/SPKI keys)
 * Signature scheme:  "ed25519:worldid:v1"
 * Message format:    see canonicalMessage()
 *
 * Docs:
 *   Nullifier:        https://docs.world.org/world-id/concepts
 *   Verify API:        https://docs.world.org/api-reference/developer-portal/verify
 */

import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorldSignature = {
  algorithm: "ed25519";
  /** The canonical message that was signed (pipe-delimited). */
  message: string;
  signature_b64: string;
  public_key_pem: string;
};

/**
 * Normalized World ID proof fields, stored in the attestation payload.
 * Populated from the IDKitResult after backend verification succeeds.
 *
 * v3 (orbLegacy): merkle_root is the on-chain Merkle root at proof time.
 */
export type WorldcoinProof = {
  proof_status: "verified" | "failed";
  /** Unique per (user, action). Used as the human-identity anchor. */
  nullifier_hash: string;
  /** Session ID returned by the World ID Developer API on verification. */
  miniapp_session_id: string;
  /** v3: on-chain Semaphore Merkle root. */
  merkle_root: string;
  verification_level: string;
  version?: number;
  action: string;
  /** The IDKit signal — bound to content_hash so proof is tied to this content. */
  signal?: string;
  gps_location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
    captured_at_ms?: number;
  };
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/**
 * Serializes public-values entries into a length-prefixed binary format
 * for deterministic hashing.
 * Each entry is encoded as: [4-byte LE length][UTF-8 JSON bytes].
 */
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

// ---------------------------------------------------------------------------
// Canonical message — the string that gets ED25519-signed
// ---------------------------------------------------------------------------

/**
 * Builds the deterministic pipe-delimited message for ED25519 signing.
 *
 * Format: "livy-worldcoin-v1|{content_hash}|{nullifier_hash}|{action}|{signal}|{timestamp_ms}|{content_id}"
 *
 * Fields are ordered so the most stable identifiers come first.
 * signal defaults to "" if absent.
 */
export function canonicalMessage(parts: {
  content_hash: string;
  content_id: string;
  nullifier_hash: string;
  action: string;
  signal?: string;
  gps_latitude?: number;
  gps_longitude?: number;
  gps_captured_at_ms?: number;
  timestamp_ms: number;
}): string {
  return [
    "livy-worldcoin-v2",
    parts.content_hash,
    parts.nullifier_hash,
    parts.action,
    parts.signal ?? "",
    parts.gps_latitude != null ? String(parts.gps_latitude) : "",
    parts.gps_longitude != null ? String(parts.gps_longitude) : "",
    parts.gps_captured_at_ms != null ? String(parts.gps_captured_at_ms) : "",
    String(parts.timestamp_ms),
    parts.content_id,
  ].join("|");
}

// ---------------------------------------------------------------------------
// ED25519 sign / verify
// ---------------------------------------------------------------------------

/**
 * Signs a message with the backend's ED25519 private key.
 * Keys are generated once on startup and persisted to state/ (see key-material.ts).
 */
export function makeWorldSignature(message: string, privateKeyPem: string, publicKeyPem: string): WorldSignature {
  const sig = cryptoSign(null, Buffer.from(message, "utf8"), privateKeyPem);
  return {
    algorithm: "ed25519",
    message,
    signature_b64: sig.toString("base64"),
    public_key_pem: publicKeyPem,
  };
}

/**
 * Verifies an ED25519 signature produced by makeWorldSignature.
 * Returns true if the signature is valid for the embedded message and public key.
 */
export function verifyWorldSignature(sig: WorldSignature): boolean {
  return cryptoVerify(
    null,
    Buffer.from(sig.message, "utf8"),
    sig.public_key_pem,
    Buffer.from(sig.signature_b64, "base64"),
  );
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

/**
 * Assembles and signs a complete Livy first-entry provenance payload.
 *
 * Steps:
 *   1. Build relation_markers (structured tags for the Livy index).
 *   2. Build public_values_entries (ordered list of public commitments).
 *   3. Wire-encode and SHA-256 the public values for the commitment hash.
 *   4. Derive the canonical message and produce an ED25519 signature.
 *   5. Return the complete payload.
 */
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
  if (input.worldcoin_proof.gps_location) {
    relationMarkers.push(`gps:lat:${input.worldcoin_proof.gps_location.latitude}`);
    relationMarkers.push(`gps:lon:${input.worldcoin_proof.gps_location.longitude}`);
    if (input.worldcoin_proof.gps_location.captured_at_ms != null) {
      relationMarkers.push(`gps:captured_at_ms:${input.worldcoin_proof.gps_location.captured_at_ms}`);
    }
  }

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
    gps_latitude: input.worldcoin_proof.gps_location?.latitude,
    gps_longitude: input.worldcoin_proof.gps_location?.longitude,
    gps_captured_at_ms: input.worldcoin_proof.gps_location?.captured_at_ms,
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
    signature_algorithm: "ed25519:worldid:v2",
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
