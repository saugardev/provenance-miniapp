# worldcoin-miniapp

Node + TypeScript backend for World ID first-entry ingestion and signing.

## What it does

- Verifies World ID proof with `POST /api/v4/verify/{rp_id}`.
- Signs canonical image-hash message server-side (Ed25519).
- Writes backend state and latest signed first-entry JSON.
- Uses deterministic public-values wire format:
  - `[u32 little-endian length][JSON-encoded entry bytes]` repeated
  - `public_values_commitment_hash_hex = SHA-256(wire bytes)`

## Run

From `livy-hackathon`:

```bash
cd /path/to/livy-hackathon/worldcoin-miniapp
npm run dev
```

The server listens on `http://127.0.0.1:3000` by default.
`npm run dev` loads env vars from `../.env` (that is `/livy-hackathon/.env`).

## API

1. Submit image hash + World ID proof:

```bash
curl -sX POST http://127.0.0.1:3000/api/submit-image \
  -H 'content-type: application/json' \
  -d '{
    "content_id":"photo-001",
    "content_hash":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "worldcoin_proof":{
      "action":"your_action",
      "signal":"optional_signal",
      "proof":"0x...",
      "merkle_root":"0x...",
      "nullifier_hash":"0x...",
      "verification_level":"orb",
      "version":1
    }
  }' | jq .
```

`content_hash` must be `sha256:<64 hex>`.

Response includes `payload` (signed first-entry JSON) and persists:

- `worldcoin-miniapp/state/backend-state.json`
- `worldcoin-miniapp/state/latest-worldcoin-first-entry.json`

## Required Env

- `WORLDCOIN_RP_ID` (use `rp_...` from World Developer Portal; `app_...` is treated as legacy-compatible)

Optional:
- `WORLDCOIN_API_KEY`
- `WORLDCOIN_VERIFY_BASE_URL` (default: `https://developer.world.org`)
- `WORLDCOIN_MODE` (`dev` or `build`)

This backend only accepts World ID verification results from the World verify API.
