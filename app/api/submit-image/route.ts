/**
 * POST /api/submit-image
 *
 * Full submit pipeline:
 *   1. Re-verify the World ID proof server-side (don't trust frontend-only verification).
 *   2. Extract nullifier, verificationLevel, merkleRoot from the IDKitResult.
 *   3. Build and ED25519-sign a Livy provenance attestation payload.
 *   4. Persist the payload to state/ and return it.
 *
 * Uses v3 orbLegacy proofs (merkle_root included).
 *
 * Docs:
 *   Verify API:          https://docs.world.org/api-reference/developer-portal/verify
 *   Nullifier (concepts): https://docs.world.org/world-id/concepts
 *
 * Request:
 *   {
 *     content_id:    string           — stable identifier for the piece of content
 *     content_hash:  "sha256:<hex>"   — SHA-256 of the image (bound to the proof signal)
 *     timestamp_ms?: number           — defaults to Date.now()
 *     idkitResponse: IDKitResult      — raw result from World App
 *   }
 */

import { NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOrCreateKeyMaterial } from "../../../src/key-material.ts";
import { appendSubmission, hasSubmissionForNullifierAction, loadState, saveState } from "../../../src/state.ts";
import { buildWorldcoinFirstEntry, type WorldcoinProof } from "../../../src/worldcoin-first-entry.ts";
import { verifyIdKitResponse, extractIdkitFields } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

type SubmitBody = {
  content_id?: string;
  content_hash?: string;
  timestamp_ms?: number;
  idkitResponse?: unknown;
};

export async function POST(req: Request) {
  console.log("[submit-image] request received");
  try {
    const body = (await req.json()) as SubmitBody;

    // --- Input validation ---
    const content_id = String(body?.content_id ?? "").trim();
    const content_hash = String(body?.content_hash ?? "").trim();
    const timestamp_ms = Number.isFinite(Number(body?.timestamp_ms)) ? Number(body.timestamp_ms) : Date.now();

    if (!content_id || !content_hash) {
      console.warn("[submit-image] missing content_id or content_hash");
      return NextResponse.json({ error: "content_id and content_hash are required" }, { status: 400 });
    }
    if (!/^sha256:[0-9a-f]{64}$/i.test(content_hash)) {
      console.warn(`[submit-image] invalid content_hash format: "${content_hash}"`);
      return NextResponse.json({ error: "content_hash must be sha256:<64 hex chars>" }, { status: 400 });
    }
    if (!body?.idkitResponse) {
      console.warn("[submit-image] missing idkitResponse");
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }

    console.log(`[submit-image] content_id="${content_id}" content_hash="${content_hash}" timestamp_ms=${timestamp_ms}`);

    // --- Resolve action (v3 orbLegacy may omit it) ---
    const configuredAction = process.env.WORLDCOIN_ACTION?.trim() ?? "";
    const resultAction = String((body.idkitResponse as any)?.action ?? "").trim();
    const action = configuredAction || resultAction || "upload-photo";

    // Inject action before forwarding — required by the Developer API
    const idkitPayload = { ...(body.idkitResponse as object), action };

    // --- Step 1: Re-verify proof server-side ---
    // Forwards IDKitResult as-is to /api/v4/verify/{rp_id}.
    console.log(`[submit-image] verifying proof action="${action}" protocol_version=${(body.idkitResponse as any)?.protocol_version ?? "unknown"}`);
    const verification = await verifyIdKitResponse(idkitPayload);
    if (!verification.success) {
      console.warn("[submit-image] ✗ proof verification failed:", JSON.stringify(verification.detail));
      return NextResponse.json(
        { error: "World ID proof verification failed", detail: verification.detail },
        { status: 401 },
      );
    }
    console.log(`[submit-image] ✓ proof verified session_id="${verification.session_id}" environment="${verification.environment}"`);

    // --- Step 2: Extract proof fields ---
    // nullifier  — unique per (user, action); used as a human-identity anchor.
    // merkleRoot — on-chain anchor for v3 (orbLegacy).
    // verificationLevel — e.g. "orb".
    const { nullifier, verificationLevel, merkleRoot } = extractIdkitFields(idkitPayload);
    console.log(`[submit-image] nullifier="${nullifier}" verificationLevel="${verificationLevel}" merkleRoot="${merkleRoot || "(missing)"}"`);
    if (!nullifier) {
      console.warn("[submit-image] verified payload missing nullifier");
      return NextResponse.json(
        { error: "Verified IDKit payload is missing nullifier" },
        { status: 400 },
      );
    }

    // --- Step 3: Build and sign the Livy provenance payload ---
    const dataDir = resolve(process.cwd(), "state");
    const statePath = resolve(dataDir, "backend-state.json");
    const state = loadState(statePath);

    // Replay protection (World docs Step 6):
    // reject if this (nullifier, action) pair has already been submitted.
    if (hasSubmissionForNullifierAction(state, nullifier, action)) {
      console.warn(`[submit-image] duplicate nullifier replay blocked nullifier="${nullifier}" action="${action}"`);
      return NextResponse.json(
        { error: "This World ID has already submitted for this action (duplicate nullifier)." },
        { status: 409 },
      );
    }

    const keyMaterial = loadOrCreateKeyMaterial(
      resolve(dataDir, "signing_private_key.pem"),
      resolve(dataDir, "signing_public_key.pem"),
    );

    const worldcoinProof: WorldcoinProof = {
      proof_status: "verified",
      nullifier_hash: nullifier,
      miniapp_session_id: verification.session_id ?? `session-${timestamp_ms}`,
      merkle_root: merkleRoot,
      verification_level: verificationLevel,
      action,
      signal: content_hash, // signal was bound to the content hash in IDKit.request()
    };

    const mode = (process.env.WORLDCOIN_MODE?.toLowerCase() === "build" ? "build" : "dev") as "dev" | "build";
    const payload = buildWorldcoinFirstEntry(
      { mode, timestamp_ms, content_id, content_hash, worldcoin_proof: worldcoinProof },
      keyMaterial,
    );

    // --- Step 4: Persist ---
    mkdirSync(dataDir, { recursive: true });
    saveState(statePath, appendSubmission(state, payload));
    writeFileSync(resolve(dataDir, "latest-worldcoin-first-entry.json"), JSON.stringify(payload, null, 2), "utf8");

    console.log(`[submit-image] ✓ payload built and persisted signature="${payload.signature.slice(0, 16)}..."`);

    return NextResponse.json({
      ok: true,
      session_id: verification.session_id,
      nullifier_hash: nullifier,
      verification_level: verificationLevel,
      payload,
      verification_environment: verification.environment,
      verification_detail: verification.detail,
    });
  } catch (err) {
    console.error("[submit-image] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
