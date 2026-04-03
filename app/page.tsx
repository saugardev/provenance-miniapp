"use client";

import { MiniKit, type VerificationLevel } from "@worldcoin/minikit-js";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

type WorldProofInput = {
  action: string;
  signal: string;
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
  version: string;
};

type SubmitResponse = {
  ok: boolean;
  payload?: unknown;
  latest_path?: string;
  verification_environment?: string;
  error?: string;
  detail?: unknown;
};

function asVerificationLevel(value: string): VerificationLevel {
  return value as VerificationLevel;
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
  const [file, setFile] = useState<File | null>(null);
  const [contentId, setContentId] = useState("photo-001");
  const [contentHash, setContentHash] = useState("");
  const [proof, setProof] = useState<WorldProofInput>({
    action: "upload_photo",
    signal: "",
    proof: "",
    merkle_root: "",
    nullifier_hash: "",
    verification_level: "orb",
    version: "1",
  });
  const [busyHash, setBusyHash] = useState(false);
  const [busySubmit, setBusySubmit] = useState(false);
  const [busyWorldVerify, setBusyWorldVerify] = useState(false);
  const [miniKitReady, setMiniKitReady] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState("");

  const hashPreview = useMemo(() => {
    if (!contentHash) return "";
    return contentHash.length > 36 ? `${contentHash.slice(0, 24)}...${contentHash.slice(-10)}` : contentHash;
  }, [contentHash]);

  useEffect(() => {
    try {
      MiniKit.install();
      setMiniKitReady(MiniKit.isInstalled());
    } catch {
      setMiniKitReady(false);
    }
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError("");
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

  function updateProof<K extends keyof WorldProofInput>(key: K, value: WorldProofInput[K]) {
    setProof((prev) => ({ ...prev, [key]: value }));
  }

  async function fillFromMiniKit() {
    setBusyWorldVerify(true);
    setError("");
    try {
      if (!MiniKit.isInstalled()) {
        throw new Error("MiniKit verify API not found. Open this app inside World App Mini App context.");
      }

      const out = await MiniKit.commandsAsync.verify({
        action: proof.action.trim(),
        signal: proof.signal.trim() || undefined,
        verification_level: asVerificationLevel(proof.verification_level.trim() || "orb"),
      });

      const anyOut = out as any;
      const payload = anyOut?.finalPayload ?? anyOut?.payload ?? anyOut ?? {};
      const nextProof = {
        proof: String(payload?.proof ?? ""),
        merkle_root: String(payload?.merkle_root ?? ""),
        nullifier_hash: String(payload?.nullifier_hash ?? ""),
        verification_level: String(payload?.verification_level ?? proof.verification_level),
        version: payload?.version != null ? String(payload.version) : proof.version,
      };

      if (!nextProof.proof || !nextProof.merkle_root || !nextProof.nullifier_hash) {
        throw new Error("MiniKit response did not include proof/merkle_root/nullifier_hash.");
      }

      setProof((prev) => ({
        ...prev,
        ...nextProof,
      }));
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

      const body = {
        content_id: contentId.trim(),
        content_hash: contentHash,
        timestamp_ms: Date.now(),
        worldcoin_proof: {
          action: proof.action.trim(),
          signal: proof.signal.trim() || undefined,
          proof: proof.proof.trim(),
          merkle_root: proof.merkle_root.trim(),
          nullifier_hash: proof.nullifier_hash.trim(),
          verification_level: proof.verification_level.trim(),
          version: Number.isFinite(Number(proof.version)) ? Number(proof.version) : undefined,
        },
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

        <h2>World Proof</h2>
        <div className="row two">
          <label className="field">
            <span>action</span>
            <input value={proof.action} onChange={(e) => updateProof("action", e.target.value)} />
          </label>
          <label className="field">
            <span>signal (optional)</span>
            <input value={proof.signal} onChange={(e) => updateProof("signal", e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>proof</span>
          <textarea value={proof.proof} onChange={(e) => updateProof("proof", e.target.value)} rows={2} />
        </label>

        <div className="row two">
          <label className="field">
            <span>merkle_root</span>
            <input value={proof.merkle_root} onChange={(e) => updateProof("merkle_root", e.target.value)} />
          </label>
          <label className="field">
            <span>nullifier_hash</span>
            <input value={proof.nullifier_hash} onChange={(e) => updateProof("nullifier_hash", e.target.value)} />
          </label>
        </div>

        <div className="row two">
          <label className="field">
            <span>verification_level</span>
            <input value={proof.verification_level} onChange={(e) => updateProof("verification_level", e.target.value)} />
          </label>
          <label className="field">
            <span>version</span>
            <input value={proof.version} onChange={(e) => updateProof("version", e.target.value)} />
          </label>
        </div>

        <button className="button secondary" disabled={busyWorldVerify} onClick={fillFromMiniKit}>
          {busyWorldVerify ? "Verifying..." : "Try World MiniKit Verify"}
        </button>
        <p className="hint">MiniKit: {miniKitReady ? "installed" : "not detected (open in World App)"}</p>

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
