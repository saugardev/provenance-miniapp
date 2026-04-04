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

function formatLogMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
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
  const [clientLogs, setClientLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);

  const hashPreview = useMemo(() => {
    if (!contentHash) return "";
    return contentHash.length > 36 ? `${contentHash.slice(0, 24)}...${contentHash.slice(-10)}` : contentHash;
  }, [contentHash]);

  function logClient(message: string, meta?: unknown) {
    const stamp = new Date().toISOString();
    const suffix = formatLogMeta(meta);
    const line = suffix ? `[${stamp}] ${message} ${suffix}` : `[${stamp}] ${message}`;
    console.log(`[miniapp] ${message}`, meta ?? "");
    setClientLogs((prev) => {
      const next = prev.length >= 300 ? prev.slice(prev.length - 299) : prev.slice();
      next.push(line);
      return next;
    });
  }

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

  async function verify() {
    setBusyVerify(true);
    setError("");
    setConnectorURI("");
    setIdkitResult(null);
    setVerifiedByBackend(false);
    let waitingTicker: ReturnType<typeof setInterval> | null = null;
    let waitingLogTicker: ReturnType<typeof setInterval> | null = null;

    try {
      logClient("Starting verification", { mode: "legacy", action: ACTION });
      if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
        throw new Error("Select an image first — the signal is bound to the content hash.");
      }
      if (!APP_ID.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is not set (must start with app_).");
      }

      // Step 1 — fetch RP context from backend (signing key never leaves the server)
      setVerifyStatus("Fetching RP signature...");
      const verifyTimeoutMs = 900_000;
      const rpTtlSeconds = 900;
      logClient("Fetching RP signature", { verifyTimeoutMs, rpTtlSeconds, preset: "orbLegacy" });

      const rpResp = await fetch("/api/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: ACTION, ttl_seconds: rpTtlSeconds }),
      });
      if (!rpResp.ok) {
        const err = await rpResp.json().catch(() => ({}));
        throw new Error(`RP signature failed: ${JSON.stringify(err)}`);
      }
      const rp = (await rpResp.json()) as RpSignatureResponse;
      logClient("RP signature received", { rp_id: rp.rp_id, expires_at: rp.expires_at });

      setVerifyStatus("Connecting to World App...");
      logClient("Building IDKit request");

      // Step 2 — create IDKit request
      // signal is bound to the image hash so the proof is cryptographically tied to this content.
      // v3 orbLegacy only.
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
        allow_legacy_proofs: true,
      });

      const request = await builder.preset(orbLegacy({ signal: contentHash }));

      // connectorURI is empty inside World App (postMessage), non-empty on web (bridge/QR)
      if (request.connectorURI) {
        setConnectorURI(request.connectorURI);
        setVerifyStatus("Open World App to approve...");
        logClient("Connector URI available (web bridge/QR)");
      } else {
        setVerifyStatus("Approve the request in World App...");
        logClient("Running inside World App (no connector URI)");
      }

      // Step 3 — use IDKit completion API (no manual pollOnce loop)
      setVerifyStatus("Waiting for World App confirmation...");
      const startedAt = Date.now();
      logClient("Waiting for World App confirmation (poll loop started)");
      waitingTicker = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        setVerifyStatus(`Waiting for World App confirmation... (${elapsedSec}s)`);
      }, 2_000);
      waitingLogTicker = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        logClient("Still waiting for completion", { elapsedSec });
      }, 10_000);
      const completion = await request.pollUntilCompletion({
        pollInterval: 2_000,
        timeout: verifyTimeoutMs,
      });
      if (!completion.success) {
        if (completion.error === IDKitErrorCodes.Timeout) {
          throw new Error(
            "Verification timed out after 15 minutes. v3 orb proofs can be delayed when inclusion is pending; retry later.",
          );
        }
        if (completion.error === IDKitErrorCodes.Cancelled) {
          throw new Error("Verification was cancelled in World App.");
        }
        throw new Error(idkitErrorMessage(completion.error));
      }
      const idResult = completion.result;
      logClient("Proof captured", { protocol_version: (idResult as any)?.protocol_version ?? "unknown" });

      // Step 4 — verify proof on backend
      setVerifyStatus("Verifying proof on backend...");
      logClient("Sending proof to backend verify");
      const verifyResp = await fetch("/api/verify-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rp_id: rp.rp_id, idkitResponse: idResult }),
      });
      const verifyJson = await verifyResp.json();
      if (!verifyResp.ok || !verifyJson?.success) {
        throw new Error(`Backend verification failed: ${JSON.stringify(verifyJson?.detail ?? verifyJson)}`);
      }
      logClient("Backend verification succeeded", {
        session_id: verifyJson?.session_id,
        nullifier_hash: verifyJson?.nullifier_hash,
      });

      setIdkitResult(idResult);
      setVerifiedByBackend(true);
      setVerifyStatus("");
      setConnectorURI("");
    } catch (err) {
      logClient("Verification failed", String(err));
      setError(String(err));
      setVerifyStatus("");
      setConnectorURI("");
    } finally {
      if (waitingTicker !== null) clearInterval(waitingTicker);
      if (waitingLogTicker !== null) clearInterval(waitingLogTicker);
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
        <h2>World ID Proof (Orb Legacy v3)</h2>

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

        <div className="result">
          <div className="log-toolbar">
            <h2>Mini App Logs</h2>
            <div>
              <button className="button secondary" type="button" onClick={() => setShowLogs((v) => !v)}>
                {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
              <button className="button secondary" type="button" onClick={() => setClientLogs([])}>
                Clear
              </button>
            </div>
          </div>
          {showLogs ? (
            <pre className="log-pre">{clientLogs.length ? clientLogs.join("\n") : "No logs yet."}</pre>
          ) : null}
        </div>
      </section>
    </main>
  );
}
