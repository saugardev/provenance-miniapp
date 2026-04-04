"use client";

import { IDKit, orbLegacy, IDKitErrorCodes, type IDKitResult } from "@worldcoin/idkit";
import { ChangeEvent, useMemo, useState } from "react";

// ---- types ----------------------------------------------------------------

type RpSignatureResponse = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
};

type SubmitResponse = {
  ok: boolean;
  payload?: unknown;
  verification_environment?: string;
  error?: string;
  detail?: unknown;
};

// ---- helpers ---------------------------------------------------------------

const IDKIT_ERROR_MESSAGES: Record<string, string> = {
  [IDKitErrorCodes.InclusionProofPending]:
    "Your orb verification is still being confirmed on-chain. This can take up to 24h after your orb scan — try again later.",
  [IDKitErrorCodes.InclusionProofFailed]:
    "Inclusion proof check failed. Your verification may not have been registered yet.",
  [IDKitErrorCodes.CredentialUnavailable]:
    "No matching World ID credential found. Make sure you are orb-verified.",
  [IDKitErrorCodes.UserRejected]: "You rejected the verification in World App.",
  [IDKitErrorCodes.VerificationRejected]: "Verification was rejected by World App.",
  [IDKitErrorCodes.MaxVerificationsReached]:
    "You have already verified this action the maximum number of times.",
  [IDKitErrorCodes.ConnectionFailed]:
    "Could not connect to World App. Make sure you are inside the World App mini app.",
  [IDKitErrorCodes.Timeout]: "Verification timed out. Please try again.",
  [IDKitErrorCodes.Cancelled]: "Verification was cancelled.",
  [IDKitErrorCodes.GenericError]: "An unexpected error occurred in World App.",
};

function idkitErrorMessage(code: string): string {
  return IDKIT_ERROR_MESSAGES[code] ?? `World ID error: ${code}`;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- component -------------------------------------------------------------

export default function Page() {
  const ACTION = (process.env.NEXT_PUBLIC_WORLDCOIN_ACTION ?? "upload-photo").trim();
  const APP_ID = (process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "") as `app_${string}`;

  // image state
  const [file, setFile] = useState<File | null>(null);
  const [contentId, setContentId] = useState("photo-001");
  const [contentHash, setContentHash] = useState("");
  const [busyHash, setBusyHash] = useState(false);

  // "legacy" → orbLegacy preset (World ID v3, Semaphore Merkle proof, merkle_root populated)
  // "v4"     → proof_of_human constraint (World ID 4, no merkle_root)
  // Docs: https://docs.world.org/world-id/idkit/integrate#choosing-a-preset
  const [mode, setMode] = useState<"legacy" | "v4">("legacy");

  // verification state
  const [idkitResult, setIdkitResult] = useState<IDKitResult | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("");
  const [connectorURI, setConnectorURI] = useState("");

  // submit state
  const [busySubmit, setBusySubmit] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);

  // shared error
  const [error, setError] = useState("");

  const hashPreview = useMemo(() => {
    if (!contentHash) return "";
    return contentHash.length > 36 ? `${contentHash.slice(0, 24)}...${contentHash.slice(-10)}` : contentHash;
  }, [contentHash]);

  // ---- handlers ------------------------------------------------------------

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setError("");
    setSubmitResult(null);
    setIdkitResult(null);
    setVerifiedByBackend(false);
    setContentHash("");
    if (!selected) return;

    setBusyHash(true);
    try {
      const hex = await sha256Hex(selected);
      setContentHash(`sha256:${hex}`);
      if (!contentId || contentId === "photo-001") {
        setContentId(`photo-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      }
    } catch (err) {
      setError(`Failed to hash image: ${String(err)}`);
    } finally {
      setBusyHash(false);
    }
  }

  function switchMode(next: "legacy" | "v4") {
    setMode(next);
    setIdkitResult(null);
    setVerifiedByBackend(false);
    setError("");
    setSubmitResult(null);
    setVerifyStatus("");
    setConnectorURI("");
  }

  async function verify() {
    setBusyVerify(true);
    setError("");
    setConnectorURI("");
    setIdkitResult(null);
    setVerifiedByBackend(false);

    try {
      if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
        throw new Error("Select an image first — the signal is bound to the content hash.");
      }
      if (!APP_ID.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is not set (must start with app_).");
      }

      // Step 1 — fetch RP context from backend (signing key never leaves the server)
      setVerifyStatus("Fetching RP signature...");
      const rpResp = await fetch("/api/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: ACTION }),
      });
      if (!rpResp.ok) {
        const err = await rpResp.json().catch(() => ({}));
        throw new Error(`RP signature failed: ${JSON.stringify(err)}`);
      }
      const rp = (await rpResp.json()) as RpSignatureResponse;

      setVerifyStatus("Connecting to World App...");

      // Step 2 — create IDKit request
      // signal is bound to the image hash so the proof is cryptographically tied to this content.
      // allow_legacy_proofs must match the preset: true for orbLegacy (v3), false for v4.
      // Docs: https://docs.world.org/world-id/idkit/integrate
      const builder = IDKit.request({
        app_id: APP_ID,
        action: ACTION,
        rp_context: {
          rp_id: rp.rp_id,
          nonce: rp.nonce,
          created_at: rp.created_at,
          expires_at: rp.expires_at,
          signature: rp.sig,
        },
        allow_legacy_proofs: mode === "legacy",
      });

      // v3 (orbLegacy): returns IDKitResult with responses[0].merkle_root populated.
      // v4 (proof_of_human): returns IDKitResult without merkle_root.
      // Both shapes are forwarded as-is to the backend verify endpoint.
      const request = await (mode === "legacy"
        ? builder.preset(orbLegacy({ signal: contentHash }))
        : builder.constraints({ type: "proof_of_human", signal: contentHash }));

      // connectorURI is empty inside World App (postMessage), non-empty on web (bridge/QR)
      if (request.connectorURI) {
        setConnectorURI(request.connectorURI);
        setVerifyStatus("Open World App to approve...");
      } else {
        setVerifyStatus("Approve the request in World App...");
      }

      // Step 3 — poll for result with live status updates
      const deadline = Date.now() + 90_000;
      let elapsed = 0;

      while (true) {
        if (Date.now() > deadline) {
          throw new Error(
            "Timed out waiting for World App (90s). " +
            "If you were recently orb-verified, your inclusion proof may still be pending on-chain — wait a few hours and try again.",
          );
        }

        const status = await request.pollOnce();

        if (status.type === "waiting_for_connection") {
          setVerifyStatus("Waiting for World App to connect...");
        } else if (status.type === "awaiting_confirmation") {
          setConnectorURI("");
          elapsed += 1;
          setVerifyStatus(`Generating ZK proof in World App... (${elapsed}s)`);
        } else if (status.type === "confirmed") {
          const idResult = status.result!;

          // Step 4 — verify proof on backend
          setVerifyStatus("Verifying proof on backend...");
          const verifyResp = await fetch("/api/verify-proof", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idkitResponse: idResult }),
          });
          const verifyJson = await verifyResp.json();
          if (!verifyResp.ok || !verifyJson?.success) {
            throw new Error(`Backend verification failed: ${JSON.stringify(verifyJson?.detail ?? verifyJson)}`);
          }

          setIdkitResult(idResult);
          setVerifiedByBackend(true);
          setVerifyStatus("");
          setConnectorURI("");
          break;
        } else {
          // failed
          throw new Error(idkitErrorMessage(status.error ?? IDKitErrorCodes.GenericError));
        }

        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      setError(String(err));
      setVerifyStatus("");
      setConnectorURI("");
    } finally {
      setBusyVerify(false);
    }
  }

  async function submit() {
    if (!verifiedByBackend || !idkitResult) {
      setError("Complete World ID verification first.");
      return;
    }
    if (!contentId.trim()) {
      setError("content_id is required.");
      return;
    }

    setBusySubmit(true);
    setError("");
    setSubmitResult(null);

    try {
      const resp = await fetch("/api/submit-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_id: contentId.trim(),
          content_hash: contentHash,
          timestamp_ms: Date.now(),
          idkitResponse: idkitResult,
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setSubmitResult(data);
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusySubmit(false);
    }
  }

  // ---- render --------------------------------------------------------------

  return (
    <main className="page">
      <section className="card">
        <h1>Livy World Mini App</h1>
        <p className="muted">
          Hash an image, bind it to a World ID proof, then sign and store the attestation.
        </p>

        {/* Image */}
        <label className="field">
          <span>Image</span>
          <input type="file" accept="image/*" onChange={onFile} />
        </label>
        <div className="row two">
          <label className="field">
            <span>content_id</span>
            <input value={contentId} onChange={(e) => setContentId(e.target.value)} placeholder="photo-001" />
          </label>
          <label className="field">
            <span>content_hash (SHA-256)</span>
            <input value={contentHash} onChange={(e) => setContentHash(e.target.value)} placeholder="sha256:..." />
          </label>
        </div>
        <p className="hint">
          {busyHash ? "Hashing..." : hashPreview ? `Hash: ${hashPreview}` : "Select an image to compute SHA-256."}
        </p>

        {/* World ID verification */}
        <h2>World ID Proof</h2>
        <div className="tabs">
          <button className={`tab${mode === "legacy" ? " active" : ""}`} onClick={() => switchMode("legacy")}>
            Orb Legacy (v3)
          </button>
          <button className={`tab${mode === "v4" ? " active" : ""}`} onClick={() => switchMode("v4")}>
            World ID 4.0
          </button>
        </div>

        <div className="row two">
          <label className="field">
            <span>action</span>
            <input value={ACTION} readOnly />
          </label>
          <label className="field">
            <span>signal (image hash)</span>
            <input value={contentHash} readOnly placeholder="select an image first" />
          </label>
        </div>

        <button className="button secondary" disabled={busyVerify} onClick={verify}>
          {busyVerify ? "Verifying..." : "Verify with World ID"}
        </button>

        {verifyStatus ? <p className="hint">⏳ {verifyStatus}</p> : null}

        {connectorURI ? (
          <div className="result" style={{ padding: "12px" }}>
            <p className="hint" style={{ marginBottom: "8px" }}>
              Not inside World App — tap to open and approve:
            </p>
            <a className="button secondary" href={connectorURI} target="_blank" rel="noopener noreferrer"
               style={{ display: "inline-block", textAlign: "center" }}>
              Open in World App
            </a>
          </div>
        ) : null}

        <p className="hint">
          {idkitResult
            ? `✅ Proof captured (protocol ${(idkitResult as any).protocol_version})`
            : "Proof: not captured yet"}
        </p>
        <p className="hint">Backend verify: {verifiedByBackend ? "✅ success" : "pending"}</p>

        {/* Sign & submit */}
        <button className="button" disabled={busySubmit || !verifiedByBackend} onClick={submit}>
          {busySubmit ? "Signing..." : "Sign & Submit"}
        </button>

        {file ? <p className="hint">File: {file.name}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {submitResult ? (
          <div className="result">
            <h2>Result</h2>
            <pre>{JSON.stringify(submitResult, null, 2)}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
