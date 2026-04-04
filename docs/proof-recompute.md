# Proof Recompute and Verification Guide

This document explains how to recompute and verify the full upload provenance output later, including image hash, GPS metadata binding, and backend signature checks.

## 1. Trust model (important)

There are two different attestations in this system:

1. World attestation (World Developer API):
- Verifies World ID proof fields (`nullifier`, `merkle_root`, verification level, action, signal binding).
- This is checked server-side in `/api/submit-image` before payload creation.

2. Backend attestation (this app):
- Signs the final provenance payload with backend Ed25519 key.
- Includes image hash + World-derived fields + GPS metadata in the signed message (v2).

GPS is not directly signed by World. GPS is signed by your backend signature.

## 2. Where data is stored

On successful upload, data is stored in `uploaded_images`:
- `image_bytes` (BYTEA)
- `content_hash` (`sha256:<hex>`)
- `nullifier_hash`, `merkle_root`, `verification_level`, `action`
- GPS: `gps_latitude`, `gps_longitude`, `gps_accuracy_meters`, `gps_captured_at_ms`
- `provenance_payload` (JSONB, the full signed payload)

The signed payload format is produced by:
- `src/worldcoin-first-entry.ts`

## 3. Canonical signed message format (v2)

The signed message is pipe-delimited:

`livy-worldcoin-v2|content_hash|nullifier_hash|action|signal|gps_latitude|gps_longitude|gps_captured_at_ms|timestamp_ms|content_id`

Source of truth for construction:
- `canonicalMessage()` in `src/worldcoin-first-entry.ts`

Notes:
- Empty optional fields are encoded as empty strings between separators.
- Numeric fields are converted with JavaScript `String(...)`.

## 4. Fast integrity checks from DB row

Fetch one row:

```sql
SELECT
  id,
  created_at,
  content_id,
  content_hash,
  action,
  nullifier_hash,
  verification_level,
  merkle_root,
  gps_latitude,
  gps_longitude,
  gps_accuracy_meters,
  gps_captured_at_ms,
  image_bytes,
  provenance_payload
FROM uploaded_images
WHERE id = $1;
```

Then verify:

1. `sha256(image_bytes)` equals `content_hash` (without prefix mismatch).
2. `content_hash` equals `provenance_payload.entry.content_hash`.
3. `provenance_payload.worldcoin_proof.signal` equals `content_hash`.
4. GPS columns equal `provenance_payload.worldcoin_proof.gps_location`.
5. `nullifier_hash/action/verification_level/merkle_root` columns equal values in `provenance_payload.worldcoin_proof`.

## 5. Recompute script (Node.js example)

```js
import { createHash, verify } from "node:crypto";

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function canonicalMessageV2(p) {
  return [
    "livy-worldcoin-v2",
    p.entry.content_hash,
    p.worldcoin_proof.nullifier_hash,
    p.worldcoin_proof.action,
    p.worldcoin_proof.signal ?? "",
    p.worldcoin_proof.gps_location?.latitude != null ? String(p.worldcoin_proof.gps_location.latitude) : "",
    p.worldcoin_proof.gps_location?.longitude != null ? String(p.worldcoin_proof.gps_location.longitude) : "",
    p.worldcoin_proof.gps_location?.captured_at_ms != null ? String(p.worldcoin_proof.gps_location.captured_at_ms) : "",
    String(p.timestamp_ms),
    p.entry.content_id,
  ].join("|");
}

export function verifyRow(row) {
  const p = row.provenance_payload;

  // 1) Recompute image hash
  const digestHex = sha256Hex(row.image_bytes); // Buffer from DB
  const recomputedContentHash = `sha256:${digestHex}`;
  if (recomputedContentHash !== row.content_hash) throw new Error("content_hash mismatch vs image bytes");

  // 2) Cross-check payload binding
  if (p.entry.content_hash !== row.content_hash) throw new Error("payload.entry.content_hash mismatch");
  if (p.worldcoin_proof.signal !== row.content_hash) throw new Error("payload signal mismatch");

  // 3) Recompute canonical message
  const msg = canonicalMessageV2(p);
  if (msg !== p.world_signature.message) throw new Error("canonical message mismatch");

  // 4) Verify Ed25519 signature
  const ok = verify(
    null,
    Buffer.from(p.world_signature.message, "utf8"),
    p.world_signature.public_key_pem,
    Buffer.from(p.world_signature.signature_b64, "base64"),
  );
  if (!ok) throw new Error("invalid backend signature");

  return { ok: true, recomputedContentHash };
}
```

## 6. Recompute `livy_public_values` commitment

`public_values_commitment_hash_hex` is SHA-256 of the wire format built by `wirePublicValues()`:

Entry encoding:
- For each entry in `livy_public_values.entries`:
  - 4-byte little-endian length of UTF-8 JSON bytes
  - then the JSON bytes
- Concatenate all entries
- SHA-256 the result

Code reference:
- `wirePublicValues()` in `src/worldcoin-first-entry.ts`

If recomputed hash differs from:
- `livy_public_values.public_values_commitment_hash_hex` or
- `livy_public_values.report_data_payload_hash_hex`

then payload bytes were altered.

## 7. What you cannot recompute from DB alone

With current schema, you store normalized World proof output, not the full original IDKit proof response payload.

That means later you can verify:
- image/hash binding
- GPS binding
- backend signature
- payload internal consistency

But you cannot replay the exact World verify API call without separately storing the raw proof response fields from frontend (`idkitResponse`/`proof`).

## 8. Operational recommendations

1. Keep private signing key stable and backed up (`state/signing_private_key.pem`).
2. Export public key for verifier services.
3. Never mutate stored `provenance_payload` rows after insert.
4. Add periodic audit job:
- sample rows
- recompute image hash + canonical message + signature + commitment hash
- alert on mismatches.

## 9. Versioning notes

- Canonical signature message currently uses `livy-worldcoin-v2` and includes GPS fields.
- Older payloads without GPS may use v1 format.
- Verifiers should branch by message prefix (`livy-worldcoin-v1` vs `livy-worldcoin-v2`).
