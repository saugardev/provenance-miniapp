/**
 * Legacy standalone HTTP server (alternative to the Next.js app).
 *
 * Run with: npm run dev:legacy-api
 *
 * This server replicates the POST /api/submit-image logic from the Next.js
 * route (app/api/submit-image/route.ts) as a plain Node.js HTTP server —
 * useful when running without Next.js.
 *
 * Key difference vs the Next.js route:
 *   - Accepts a pre-extracted `worldcoin_proof` object in the request body
 *     (rather than a raw IDKitResult). The caller is responsible for extracting
 *     the proof fields before calling this server.
 *   - Uses protocol_version "3.0" explicitly, making this a v3-only endpoint.
 *     For v4 proofs use the Next.js app instead.
 *
 * Docs:
 *   Cloud verification:  https://docs.world.org/world-id/quick-start/cloud
 *   Verify endpoint:     POST https://developer.world.org/api/v4/verify/{rp_id}
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { loadOrCreateKeyMaterial } from "./key-material.ts";
import { appendSubmission, loadState, saveState } from "./state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "./worldcoin-first-entry.ts";
import { resolveWorldcoinRpId } from "../lib/worldcoin-verify.ts";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";
const mode = ((process.env.WORLDCOIN_MODE ?? "dev").toLowerCase() === "build" ? "build" : "dev") as "dev" | "build";
const dataDir = resolve(process.cwd(), "state");
const statePath = resolve(dataDir, "backend-state.json");
const latestPath = resolve(dataDir, "latest-worldcoin-first-entry.json");
const privateKeyPath = resolve(dataDir, "signing_private_key.pem");
const publicKeyPath = resolve(dataDir, "signing_public_key.pem");

const keyMaterial = loadOrCreateKeyMaterial(privateKeyPath, publicKeyPath);
const worldcoinRpId = resolveWorldcoinRpId();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, statusCode: number, value: unknown) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(statusCode, {
    "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: ServerResponse, statusCode: number, value: string) {
  res.writeHead(statusCode, {
    "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(value),
  });
  res.end(value);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// v3 proof verification (protocol_version "3.0")
//
// This function manually constructs the verify request with explicit v3 fields
// (merkle_root, proof, nullifier_hash, verification_level).
// The Next.js route uses verifyIdKitResponse() from lib/worldcoin-verify.ts
// instead, which forwards the raw IDKitResult and handles both v3 and v4.
//
// Docs: https://docs.world.org/world-id/quick-start/cloud#verifying-the-proof
// ---------------------------------------------------------------------------

async function verifyWorldcoinProofV3(input: {
  action: string;
  signal?: string;
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  version?: number;
}): Promise<{ success: boolean; detail?: any; environment?: string; session_id?: string }> {
  const apiBase = process.env.WORLDCOIN_VERIFY_BASE_URL ?? "https://developer.world.org";
  const url = `${apiBase}/api/v4/verify/${worldcoinRpId}`;
  const body = {
    protocol_version: "3.0",
    action: input.action,
    signal: input.signal,
    verification_level: input.verification_level,
    proof: input.proof,
    nullifier_hash: input.nullifier_hash,
    merkle_root: input.merkle_root,
  };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.WORLDCOIN_API_KEY) {
    headers.authorization = `Bearer ${process.env.WORLDCOIN_API_KEY}`;
  }

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function isSha256Hash(v: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(v);
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendText(res, 400, "Bad request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? `${hostname}:${port}`}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, mode, state_path: statePath });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      sendText(res, 200, ["worldcoin-miniapp legacy backend", "", "POST /api/submit-image", "GET  /healthz"].join("\n"));
      return;
    }

    // POST /api/submit-image
    // Expects a pre-extracted worldcoin_proof object (v3 format).
    if (req.method === "POST" && url.pathname === "/api/submit-image") {
      const body = await readJsonBody(req);
      const content_id = String(body?.content_id ?? "").trim();
      const content_hash = String(body?.content_hash ?? "").trim();
      const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body?.timestamp_ms) : Date.now();

      const proofInput = body?.worldcoin_proof ?? {};
      const action = String(proofInput?.action ?? "").trim();
      const signal = proofInput?.signal ? String(proofInput.signal) : undefined;
      const proof = String(proofInput?.proof ?? "").trim();
      const merkle_root = String(proofInput?.merkle_root ?? "").trim();
      const nullifier_hash = String(proofInput?.nullifier_hash ?? "").trim();
      const verification_level = String(proofInput?.verification_level ?? "").trim();
      const version = Number.isFinite(Number(proofInput?.version)) ? Number(proofInput?.version) : undefined;

      if (!content_id || !content_hash) {
        sendJson(res, 400, { error: "content_id, content_hash are required" });
        return;
      }
      if (!isSha256Hash(content_hash)) {
        sendJson(res, 400, { error: "content_hash must match sha256:<64-hex>" });
        return;
      }
      if (!action || !proof || !merkle_root || !nullifier_hash || !verification_level) {
        sendJson(res, 400, {
          error: "worldcoin_proof.action, proof, merkle_root, nullifier_hash, verification_level are required",
        });
        return;
      }

      const verification = await verifyWorldcoinProofV3({
        action,
        signal,
        proof,
        merkle_root,
        nullifier_hash,
        verification_level,
        version,
      });

      if (!verification.success) {
        sendJson(res, 401, { error: "worldcoin proof verification failed", detail: verification.detail });
        return;
      }

      const worldcoin_proof: WorldcoinProof = {
        proof_status: "verified",
        nullifier_hash,
        miniapp_session_id: verification.session_id || `session-${timestamp_ms}`,
        merkle_root,
        verification_level,
        version,
        action,
        signal,
      };

      const payload = buildWorldcoinFirstEntry(
        { mode, timestamp_ms, content_id, content_hash, worldcoin_proof },
        keyMaterial,
      );

      const state = appendSubmission(loadState(statePath), payload);
      saveState(statePath, state);
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(latestPath, JSON.stringify(payload, null, 2), "utf8");

      sendJson(res, 200, { ok: true, payload, verification_environment: verification.environment, latest_path: latestPath });
      return;
    }

    sendText(res, 404, "Not found");
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
});

server.listen(port, hostname, () => {
  console.log(`worldcoin-miniapp legacy backend listening on http://${hostname}:${port}`);
});
