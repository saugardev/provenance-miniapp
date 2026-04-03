import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "./key-material.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "./worldcoin-first-entry.ts";

function fail(msg: string): never {
  throw new Error(msg);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = args[i + 1];
    if (!val || val.startsWith("--")) fail(`missing value for --${key}`);
    out[key] = val;
    i += 1;
  }
  return out;
}

const args = parseArgs();
if (!args.input) {
  fail("usage: node --experimental-strip-types src/cli.ts --input verified_request.json");
}

const reqPath = resolve(args.input);
const req = JSON.parse(readFileSync(reqPath, "utf8"));

const worldcoin_proof: WorldcoinProof = {
  proof_status: "verified",
  nullifier_hash: String(req?.worldcoin_proof?.nullifier_hash ?? ""),
  miniapp_session_id: String(req?.worldcoin_proof?.miniapp_session_id ?? `session-${Date.now()}`),
  merkle_root: String(req?.worldcoin_proof?.merkle_root ?? ""),
  verification_level: String(req?.worldcoin_proof?.verification_level ?? ""),
  version: Number.isFinite(Number(req?.worldcoin_proof?.version)) ? Number(req.worldcoin_proof.version) : undefined,
  action: String(req?.worldcoin_proof?.action ?? ""),
  signal: req?.worldcoin_proof?.signal ? String(req.worldcoin_proof.signal) : undefined,
};

if (!worldcoin_proof.nullifier_hash || !worldcoin_proof.merkle_root || !worldcoin_proof.verification_level || !worldcoin_proof.action) {
  fail("input.worldcoin_proof missing required fields: nullifier_hash, merkle_root, verification_level, action");
}
if (!req?.content_hash) {
  fail("input.content_hash is required (sha256 of uploaded image)");
}

const stateDir = resolve(process.cwd(), "state");
const keys = loadOrCreateKeyMaterial(
  resolve(stateDir, "signing_private_key.pem"),
  resolve(stateDir, "signing_public_key.pem"),
);

const payload = buildWorldcoinFirstEntry(
  {
    mode: ((process.env.WORLDCOIN_MODE ?? "dev").toLowerCase() === "build" ? "build" : "dev"),
    timestamp_ms: Number.isFinite(Number(req?.timestamp_ms)) ? Number(req.timestamp_ms) : Date.now(),
    content_id: String(req?.content_id ?? "worldcoin-entry-001"),
    content_hash: String(req?.content_hash ?? ""),
    worldcoin_proof,
  },
  keys,
);

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
