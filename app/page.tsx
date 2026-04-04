"use client";

import { IDKit, orbLegacy, IDKitErrorCodes, type IDKitResult } from "@worldcoin/idkit";
import { ChangeEvent, useMemo, useState } from "react";

type SubmitResponse = {
  ok: boolean;
  payload?: unknown;
  latest_path?: string;
  verification_environment?: string;
  error?: string;
  detail?: unknown;
};

type VerifyProofResponse = {
  success: boolean;
  detail?: unknown;
};

type RpSignatureResponse = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
};

const IDKIT_ERROR_MESSAGES: Record<string, string> = {
  [IDKitErrorCodes.InclusionProofPending]:
    "Your orb verification is still being processed on-chain (can take up to 24h after orb scan). Try again later.",
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return toHex(new Uint8Array(digest));
}

export default function Page() {
  const configuredAction = (process.env.NEXT_PUBLIC_WORLDCOIN_ACTION ?? "upload-photo").trim();
  const appId = (process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "") as `app_${string}`;

  const [file, setFile] = useState<File | null>(null);
  const [contentId, setContentId] = useState("photo-001");
  const [contentHash, setContentHash] = useState("");
  const [mode, setMode] = useState<"legacy" | "v4">("legacy");
  const [idkitResult, setIdkitResult] = useState<IDKitResult | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyHash, setBusyHash] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [busyWorldVerify, setBusyWorldVerify] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("");
  const [connectorURI, setConnectorURI] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState("");

  const hashPreview = useMemo(() => {
    if (!contentHash) return "";
    return contentHash.length > 36 ? `${contentHash.slice(0, 24)}...${contentHash.slice(-10)}` : contentHash;
  }, [contentHash]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError("");
    setIdkitResult(null);
    setVerifiedByBackend(false);
    if (!selected) {
      setContentHash("");
      return;
    }
    setBusyHash(true);
    try {
      const hex = await sha256Hex(selected);
      setContentHash(`sha256:${hex}`);
      if (!contentId || contentId === "photo-001") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        setContentId(`photo-${stamp}`);
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
    setResult(null);
    setVerifyStatus("");
    setConnectorURI("");
  }

  async function fillFromIDKit() {
    setBusyWorldVerify(true);
    setVerifyStatus("Requesting RP signature...");
    setError("");
    setConnectorURI("");
    setIdkitResult(null);
    setVerifiedByBackend(false);
    try {
      if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
        throw new Error("Select an image first so signal is bound to content_hash.");
      }
      if (!appId || !appId.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is not set or invalid (must start with app_).");
      }

      // 1. Get RP context from backend (requires RP_SIGNING_KEY)
      const rpResp = await fetch("/api/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: configuredAction }),
      });
      if (!rpResp.ok) {
        const rpErr = await rpResp.json().catch(() => ({}));
        throw new Error(`Failed to get RP signature: ${JSON.stringify(rpErr)}`);
      }
      const rpData = (await rpResp.json()) as RpSignatureResponse;

      setVerifyStatus("Connecting to World App...");

      // 2. Create IDKit request with RP context
      const builder = IDKit.request({
        app_id: appId,
        action: configuredAction,
        rp_context: {
          rp_id: rpData.rp_id,
          nonce: rpData.nonce,
          created_at: rpData.created_at,
          expires_at: rpData.expires_at,
          signature: rpData.sig,
        },
        allow_legacy_proofs: mode === "legacy",
      });

      const request = await (mode === "legacy"
        ? builder.preset(orbLegacy({ signal: contentHash }))
        : builder.constraints({ type: "proof_of_human", signal: contentHash }));

      // connectorURI is empty when inside World App (postMessage mode)
      // non-empty means web/bridge mode — show link so user can open in World App
      const inApp = !request.connectorURI;
      if (!inApp) {
        setConnectorURI(request.connectorURI);
        setVerifyStatus("Open this link in World App to continue...");
      } else {
        setVerifyStatus("Approve the request in World App...");
      }

      // 3. Poll with status updates, hard timeout of 3 minutes
      let completion;
      const deadline = Date.now() + 90 * 1000;
      let elapsed = 0;
      while (true) {
        if (Date.now() > deadline) {
          throw new Error(
            "World App did not return a proof within 90s. Since you were recently orb-verified, " +
            "your inclusion proof is likely still pending on-chain. Wait a few hours (up to 24h) and try again.",
          );
        }
        const status = await request.pollOnce();
        if (status.type === "waiting_for_connection") {
          setVerifyStatus(inApp ? "Approve the request in World App..." : "Waiting for World App to connect...");
        } else if (status.type === "awaiting_confirmation") {
          elapsed += 1;
          setConnectorURI("");
          setVerifyStatus(`Generating ZK proof in World App... (${elapsed}s elapsed)`);
        } else if (status.type === "confirmed") {
          completion = { success: true as const, result: status.result! };
          break;
        } else {
          // status.type === "failed" — map to human-readable message
          const code = status.error ?? IDKitErrorCodes.GenericError;
          throw new Error(idkitErrorMessage(code));
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const idResult = completion.result;

      // 4. Verify proof on backend
      setVerifyStatus("Verifying proof on backend...");
      const verifyResp = await fetch("/api/verify-proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idkit_result: idResult,
          action: configuredAction,
          signal: contentHash,
        }),
      });
      const verifyJson = (await verifyResp.json()) as VerifyProofResponse;
      if (!verifyResp.ok || !verifyJson?.success) {
        throw new Error(`Backend verify failed: ${JSON.stringify(verifyJson?.detail ?? verifyJson)}`);
      }

      setIdkitResult(idResult);
      setVerifiedByBackend(true);
      setVerifyStatus("");
      setConnectorURI("");
    } catch (err) {
      setError(String(err));
      setVerifyStatus("");
      setConnectorURI("");
    } finally {
      setBusyWorldVerify(false);
    }
  }

  async function submit() {
    setBusySubmit(true);
    setResult(null);
    setError("");
    try {
      if (!contentId.trim()) throw new Error("content_id is required");
      if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
        throw new Error("content_hash must be sha256:<64-hex>. Select an image first.");
      }
      if (!verifiedByBackend || !idkitResult) {
        throw new Error("Run 'Verify with World ID' first and get a successful backend verification.");
      }

      const body = {
        content_id: contentId.trim(),
        content_hash: contentHash,
        timestamp_ms: Date.now(),
        idkit_response: idkitResult,
      };

      const resp = await fetch("/api/submit-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as SubmitResponse;
      setResult(data);
      if (!resp.ok) {
        setError(data.error ?? `Request failed (${resp.status})`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusySubmit(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Livy World Mini App</h1>
        <p className="muted">Capture image hash, attach World ID 4.0 proof, then verify + sign in the same Next.js deployment.</p>

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
            <span>content_hash</span>
            <input value={contentHash} onChange={(e) => setContentHash(e.target.value)} placeholder="sha256:..." />
          </label>
        </div>

        <p className="hint">{busyHash ? "Hashing image..." : hashPreview ? `Hash ready: ${hashPreview}` : "Select an image to compute SHA-256."}</p>

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
            <input value={configuredAction} readOnly />
          </label>
          <label className="field">
            <span>signal (bound to image hash)</span>
            <input value={contentHash} readOnly />
          </label>
        </div>

        <button className="button secondary" disabled={busyWorldVerify} onClick={fillFromIDKit}>
          {busyWorldVerify ? "Verifying..." : "Verify with World ID"}
        </button>
        {verifyStatus ? <p className="hint">⏳ {verifyStatus}</p> : null}
        {connectorURI ? (
          <div className="result">
            <p className="hint">Not inside World App — tap the button to open World App and approve:</p>
            <a className="button secondary" href={connectorURI} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", textAlign: "center" }}>
              Open in World App
            </a>
          </div>
        ) : null}
        <p className="hint">Mode: {mode === "legacy" ? "Orb Legacy (protocol 3.0)" : "World ID 4.0 (protocol 4.0)"}</p>
        <p className="hint">IDKit result: {idkitResult ? `✅ captured (protocol ${(idkitResult as any).protocol_version})` : "not captured yet"}</p>
        <p className="hint">Backend verify: {verifiedByBackend ? "✅ success" : "pending"}</p>

        <button className="button" disabled={busySubmit} onClick={submit}>
          {busySubmit ? "Submitting..." : "Verify + Sign"}
        </button>

        {file ? <p className="hint">Selected: {file.name}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {result ? (
          <div className="result">
            <h2>Response</h2>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
