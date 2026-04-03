# worldcoin-miniapp

Unified Next.js app (UI + API routes) for World ID 4.0 image-hash verification and backend signing.

## What it does

- One deployment for frontend + backend (good for Vercel).
- Browser computes `sha256:<64-hex>` of uploaded image.
- Mini app can call World MiniKit verify directly.
- Server route verifies proof against World verify API.
- Server signs canonical message with Ed25519 and stores payload.
- World verify `signal` is forced to `content_hash` to bind proof to the image.

## Canonical Signature Message

`livy-worldcoin-v1|content_hash|nullifier_hash|action|signal|timestamp_ms|content_id`

## Run (local)

From `livy-hackathon`:

```bash
cd /path/to/livy-hackathon/worldcoin-miniapp
pnpm install
pnpm dev
```

App runs on `http://127.0.0.1:3000`.

Use standard Next.js env files (for example `.env.local`) or Vercel Project Environment Variables.

## API routes

- `GET /api/healthz`
- `GET /api/attestations`
- `POST /api/submit-image`

Example submit:

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

## Required env

- `WORLDCOIN_RP_ID` (`rp_...` preferred; `app_...` accepted as legacy-compatible)

Optional:

- `WORLDCOIN_API_KEY`
- `WORLDCOIN_VERIFY_BASE_URL` (default `https://developer.world.org`)
- `WORLDCOIN_MODE` (`dev` or `build`)

## Vercel

Deploy this folder (`worldcoin-miniapp`) as a Next.js project.

- Build command: `pnpm build`
- Start command: `pnpm start`
- Set env vars in Vercel project settings.
