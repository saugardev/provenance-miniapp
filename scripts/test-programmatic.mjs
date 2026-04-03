#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function startMockWorldServer(worldPort) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    if (!req.url?.startsWith("/api/v4/verify/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }

    requests.push({ url: req.url, body });

    const proofish = body?.proof || body?.responses?.[0]?.proof;
    if (!proofish) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "missing proof" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        environment: "staging",
        session_id: "sess-programmatic-001",
      }),
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(worldPort, "127.0.0.1", () => {
      resolve({
        server,
        requests,
      });
    });
  });
}

function startNext(nextPort, worldPort) {
  const env = {
    ...process.env,
    PORT: String(nextPort),
    WORLDCOIN_RP_ID: process.env.WORLDCOIN_RP_ID || "rp_programmatic_test",
    WORLDCOIN_VERIFY_BASE_URL: `http://127.0.0.1:${worldPort}`,
    WORLDCOIN_MODE: "dev",
    RP_SIGNING_KEY: process.env.RP_SIGNING_KEY || "",
  };

  const child = spawn("pnpm", ["dev"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[next:err] ${d}`));

  return child;
}

async function main() {
  const nextPort = Number(process.env.TEST_NEXT_PORT || (await pickFreePort()));
  const worldPort = Number(process.env.TEST_WORLD_PORT || (await pickFreePort()));
  const BASE_URL = `http://127.0.0.1:${nextPort}`;

  const { server: worldServer, requests } = await startMockWorldServer(worldPort);
  const next = startNext(nextPort, worldPort);

  let exitCode = 0;
  try {
    await waitForHealth(`${BASE_URL}/api/healthz`);

    const health = await fetch(`${BASE_URL}/api/healthz`).then((r) => r.json());
    assert(health.ok === true, "healthz should return ok=true");

    const idkitResponse = {
      protocol_version: "3.0",
      nonce: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      action: "upload_photo",
      environment: "staging",
      responses: [
        {
          identifier: "orb",
          signal_hash: "0xsignalhash",
          proof: "0xproof-by-idkit",
          merkle_root: "0xmerkle-by-idkit",
          nullifier: "0xnullifier-by-idkit",
        },
      ],
    };

    const verifyProofResp = await fetch(`${BASE_URL}/api/verify-proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idkitResponse }),
    });
    const verifyProofJson = await verifyProofResp.json();
    assert(verifyProofResp.status === 200, `verify-proof should be 200, got ${verifyProofResp.status}`);
    assert(verifyProofJson.success === true, "verify-proof should return success=true");

    const submitResp = await fetch(`${BASE_URL}/api/submit-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content_id: "photo-programmatic-001",
        content_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        idkit_response: idkitResponse,
      }),
    });
    const submitJson = await submitResp.json();
    assert(submitResp.status === 200, `submit-image should be 200, got ${submitResp.status}`);
    assert(submitJson.ok === true, "submit-image should return ok=true");
    assert(submitJson.payload?.world_signature?.signature_b64, "world_signature.signature_b64 missing");
    assert(
      submitJson.worldcoin_verification_input?.signal ===
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "signal should be bound to content_hash",
    );

    console.log("\nProgrammatic test passed.");
    console.log("Signature sample:", submitJson.payload.world_signature.signature_b64.slice(0, 40) + "...");
    console.log("World verify requests observed:", requests.length);

    if (process.env.RP_SIGNING_KEY) {
      const sigResp = await fetch(`${BASE_URL}/api/rp-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "upload_photo" }),
      });
      const sigJson = await sigResp.json();
      assert(sigResp.status === 200, `rp-signature should be 200 with RP_SIGNING_KEY set, got ${sigResp.status}`);
      assert(sigJson.sig && sigJson.nonce, "rp-signature payload missing sig/nonce");
      console.log("RP signature endpoint check passed.");
    } else {
      console.log("RP_SIGNING_KEY not set: skipped /api/rp-signature success assertion.");
    }
  } catch (err) {
    exitCode = 1;
    console.error("\nProgrammatic test failed:", err);
  } finally {
    try {
      next.kill("SIGTERM");
    } catch {}
    await sleep(800);
    try {
      worldServer.close();
    } catch {}
    process.exit(exitCode);
  }
}

main();
