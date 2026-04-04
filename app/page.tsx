"use client";

import { IDKit, orbLegacy, type IDKitResult } from "@worldcoin/idkit";
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
  const [idkitResult, setIdkitResult] = useState<IDKitResult | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyHash, setBusyHash] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [busyWorldVerify, setBusyWorldVerify] = useState(false);
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

  async function fillFromIDKit() {
    setBusyWorldVerify(true);
    setError("");
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

      // 2. Create IDKit request with RP context
      const request = await IDKit.request({
        app_id: appId,
        action: configuredAction,
        rp_context: {
          rp_id: rpData.rp_id,
          nonce: rpData.nonce,
          created_at: rpData.created_at,
          expires_at: rpData.expires_at,
          signature: rpData.sig,
        },
        allow_legacy_proofs: true,
      }).preset(orbLegacy({ signal: contentHash }));

      // 3. Wait for World App to return proof (postMessage in mini app, QR + polling on web)
      const completion = await request.pollUntilCompletion();
      if (!completion.success) {
        throw new Error(`World ID verification failed: ${completion.error}`);
      }
      const idResult = completion.result;

      // 4. Verify proof on backend
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
    } catch (err) {
      setError(`World verify failed: ${String(err)}`);
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

        <h2>World ID 4.0 Proof</h2>
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
        <p className="hint">IDKit result: {idkitResult ? `captured (protocol ${(idkitResult as any).protocol_version})` : "not captured yet"}</p>
        <p className="hint">Backend verify: {verifiedByBackend ? "success" : "pending"}</p>

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
