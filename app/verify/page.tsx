"use client";

import { IDKitRequestWidget, orbLegacy, IDKitErrorCodes, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { MiniKit, VerificationLevel, type MiniAppVerifyActionPayload } from "@worldcoin/minikit-js";
import { ChangeEvent, useMemo, useRef, useState } from "react";

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
  image_record_id?: number;
  signed?: boolean;
  uploaded?: boolean;
  error?: string;
  detail?: unknown;
};

type ApiFailure = {
  endpoint: string;
  status: number;
  statusText: string;
  body: unknown;
};

type MiniAppProof = {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
};

type GpsLocation = {
  latitude: number;
  longitude: number;
  accuracy_meters?: number;
  captured_at_ms: number;
};

type VerificationPayload =
  | { kind: "idkit"; idkitResponse: IDKitResult }
  | { kind: "minikit"; proof: MiniAppProof };

type MiniAppVerifySuccessPayload = Extract<MiniAppVerifyActionPayload, { status: "success" }>;

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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ---- component -------------------------------------------------------------

export default function Page() {
  const ACTION = (process.env.NEXT_PUBLIC_WORLDCOIN_ACTION ?? "upload-photo").trim();
  const APP_ID = (process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "") as `app_${string}`;
  const USE_MINIKIT = process.env.NEXT_PUBLIC_WORLDCOIN_USE_MINIKIT === "true";

  // image state
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [contentId, setContentId] = useState("photo-001");
  const [contentHash, setContentHash] = useState("");
  const [busyHash, setBusyHash] = useState(false);

  // verification state
  const [verificationPayload, setVerificationPayload] = useState<VerificationPayload | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("");
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const verifySucceededRef = useRef(false);

  // sign/upload state
  const [busySign, setBusySign] = useState(false);
  const [busyOg, setBusyOg] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [actionResult, setActionResult] = useState<SubmitResponse | null>(null);
  const [apiFailure, setApiFailure] = useState<ApiFailure | null>(null);
  const [signedPayload, setSignedPayload] = useState<unknown>(null);
  const [gpsLocation, setGpsLocation] = useState<GpsLocation | null>(null);
  const [busyGps, setBusyGps] = useState(false);

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
    setActionResult(null);
    setSignedPayload(null);
    setVerificationPayload(null);
    setVerifiedByBackend(false);
    setContentHash("");
    setVerifyStatus("");
    setWidgetOpen(false);
    setRpContext(null);
    verifySucceededRef.current = false;
    setFileBase64("");
    setGpsLocation(null);
    if (!selected) return;

    setBusyHash(true);
    try {
      const fileBuffer = await selected.arrayBuffer();
      setFileBase64(arrayBufferToBase64(fileBuffer));
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
    setVerificationPayload(null);
    setVerifiedByBackend(false);
    setActionResult(null);
    setSignedPayload(null);
    setWidgetOpen(false);
    setRpContext(null);
    verifySucceededRef.current = false;
    setGpsLocation(null);

    try {
      if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
        throw new Error("Select an image first — the signal is bound to the content hash.");
      }
      if (!APP_ID.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is not set (must start with app_).");
      }

      const isWorldApp =
        USE_MINIKIT &&
        typeof window !== "undefined" &&
        Boolean((window as Window & { WorldApp?: unknown }).WorldApp);
      if (isWorldApp) {
        logClient("Starting verification", { mode: "minikit", action: ACTION });
        setVerifyStatus("Opening World App verification...");

        const installResult =
          typeof window !== "undefined" && (window as Window & { MiniKit?: unknown }).MiniKit
            ? { success: true as const }
            : MiniKit.install(APP_ID);
        if (!installResult.success) {
          throw new Error(`MiniKit install failed: ${installResult.errorMessage}`);
        }

        const { finalPayload } = await MiniKit.commandsAsync.verify({
          action: ACTION,
          signal: contentHash,
          verification_level: VerificationLevel.Orb,
        });

        logClient("MiniKit returned verification payload", {
          status: finalPayload?.status,
          verification_level:
            finalPayload && "verification_level" in finalPayload
              ? finalPayload.verification_level
              : Array.isArray((finalPayload as any)?.verifications)
                ? (finalPayload as any).verifications.map((v: { verification_level: string }) => v.verification_level)
                : undefined,
        });

        if (!finalPayload || finalPayload.status !== "success") {
          const errorCode = finalPayload?.status === "error" ? finalPayload.error_code : "generic_error";
          throw new Error(idkitErrorMessage(errorCode));
        }

        const proof = extractMiniKitProof(finalPayload);
        setVerifyStatus("Verifying proof on backend...");
        const verifyResp = await fetch("/api/verify-proof", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof, action: ACTION, signal: contentHash }),
        });
        const verifyJson = await verifyResp.json();
        if (!verifyResp.ok || !verifyJson?.success) {
          const detail = verifyJson?.detail ?? verifyJson;
          logClient("Backend verification failed", detail);
          throw new Error(`Backend verification failed: ${JSON.stringify(detail)}`);
        }

        setVerificationPayload({ kind: "minikit", proof });
        setVerifiedByBackend(true);
        setVerifyStatus("Verified.");
        setError("");
        verifySucceededRef.current = true;
        logClient("MiniKit verification succeeded", {
          nullifier_hash: verifyJson?.nullifier_hash,
          verification_level: verifyJson?.verification_level,
        });
        return;
      }

      logClient("Starting verification", { mode: "legacy", action: ACTION });
      // Step 1 — fetch RP context from backend (signing key never leaves the server)
      setVerifyStatus("Fetching RP signature...");
      const rpTtlSeconds = 900;
      logClient("Fetching RP signature", { rpTtlSeconds, preset: "orbLegacy" });

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
      const nextRpContext: RpContext = {
        rp_id: rp.rp_id,
        nonce: rp.nonce,
        created_at: rp.created_at,
        expires_at: rp.expires_at,
        signature: rp.sig,
      };
      setRpContext(nextRpContext);
      setWidgetOpen(true);
      setVerifyStatus("Awaiting confirmation in World App...");
      logClient("Opening IDKitRequestWidget", { rp_id: nextRpContext.rp_id });
    } catch (err) {
      logClient("Verification failed", String(err));
      setError(String(err));
      setVerifyStatus("");
    } finally {
      setBusyVerify(false);
    }
  }

  async function submit() {
    if (!verifiedByBackend || !verificationPayload) {
      setError("Complete World ID verification first.");
      return;
    }
    if (!contentId.trim()) {
      setError("content_id is required.");
      return;
    }
    if (!gpsLocation) {
      setError("GPS location is required before signing.");
      return;
    }

    setBusySign(true);
    setError("");
    setActionResult(null);
    setApiFailure(null);

    try {
      const resp = await fetch("/api/sign-provenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_id: contentId.trim(),
          content_hash: contentHash,
          timestamp_ms: Date.now(),
          gps_location: gpsLocation,
          ...(verificationPayload.kind === "idkit"
            ? { idkitResponse: verificationPayload.idkitResponse }
            : { proof: verificationPayload.proof }),
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setActionResult(data);
      if (resp.ok && data?.payload) {
        setSignedPayload(data.payload);
      }
      if (!resp.ok) {
        setApiFailure({
          endpoint: "/api/sign-provenance",
          status: resp.status,
          statusText: resp.statusText,
          body: data,
        });
        setError(
          data.error
            ? `${data.error} (HTTP ${resp.status})`
            : `Request failed (${resp.status} ${resp.statusText})`,
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusySign(false);
    }
  }

  async function upload() {
    if (!signedPayload) {
      setError("Sign provenance first.");
      return;
    }
    if (!file || !fileBase64) {
      setError("Select an image first.");
      return;
    }

    setBusyUpload(true);
    setError("");
    setActionResult(null);
    setApiFailure(null);

    try {
      const resp = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_payload: signedPayload,
          consent_to_store_image: true,
          consent_scope: "ethglobal_hackathon",
          image_base64: fileBase64,
          image_mime_type: file.type || "application/octet-stream",
          image_file_name: file.name,
          image_size_bytes: file.size,
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setActionResult(data);
      if (!resp.ok) {
        setApiFailure({
          endpoint: "/api/upload-image",
          status: resp.status,
          statusText: resp.statusText,
          body: data,
        });
        setError(
          data.error
            ? `${data.error} (HTTP ${resp.status})`
            : `Request failed (${resp.status} ${resp.statusText})`,
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyUpload(false);
    }
  }

  async function publishOg() {
    if (!signedPayload) {
      setError("Sign provenance first.");
      return;
    }

    setBusyOg(true);
    setError("");
    setActionResult(null);
    setApiFailure(null);

    try {
      const resp = await fetch("/api/publish-og", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_payload: signedPayload,
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setActionResult(data);
      if (!resp.ok) {
        setApiFailure({
          endpoint: "/api/publish-og",
          status: resp.status,
          statusText: resp.statusText,
          body: data,
        });
        setError(
          data.error
            ? `${data.error} (HTTP ${resp.status})`
            : `Request failed (${resp.status} ${resp.statusText})`,
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyOg(false);
    }
  }

  function captureGpsLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }
    setBusyGps(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          captured_at_ms: Date.now(),
        });
        setBusyGps(false);
      },
      (geoError) => {
        setError(`Failed to capture GPS location: ${geoError.message}`);
        setBusyGps(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  // ---- render --------------------------------------------------------------

  return (
    <main className="page">
      <section className="card">
        <h1>Livy World Mini App</h1>
        <p className="muted">
          Hash an image, verify with World ID, sign provenance, then optionally upload the image.
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
        {rpContext ? (
          <IDKitRequestWidget
            open={widgetOpen}
            onOpenChange={(open) => {
              setWidgetOpen(open);
              if (!open && !verifySucceededRef.current) {
                setVerifyStatus("");
                setError("Verification window closed before completion.");
                logClient("Widget closed before success");
              }
            }}
            app_id={APP_ID}
            action={ACTION}
            rp_context={rpContext}
            allow_legacy_proofs={true}
            preset={orbLegacy({ signal: contentHash })}
            environment="production"
            polling={{ interval: 2_000, timeout: 900_000 }}
            autoClose={true}
            handleVerify={async (result) => {
              logClient("Widget returned proof, verifying on backend");
              setVerifyStatus("Verifying proof on backend...");
              try {
                const verifyResp = await fetch("/api/verify-proof", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ rp_id: rpContext.rp_id, idkitResponse: result }),
                });
                const verifyJson = await verifyResp.json();
                if (!verifyResp.ok || !verifyJson?.success) {
                  const detail = verifyJson?.detail ?? verifyJson;
                  logClient("Backend verification failed", detail);
                  setVerifyStatus("");
                  setError(`Backend verification failed: ${JSON.stringify(detail)}`);
                  throw new Error("Backend verification failed");
                }
                logClient("Backend verification succeeded", {
                  session_id: verifyJson?.session_id,
                  nullifier_hash: verifyJson?.nullifier_hash,
                });
                setVerificationPayload({ kind: "idkit", idkitResponse: result });
                setVerifiedByBackend(true);
                setVerifyStatus("Verified.");
                setError("");
                verifySucceededRef.current = true;
              } catch (err) {
                logClient("handleVerify exception", String(err));
                setVerifyStatus("");
                throw err;
              }
            }}
            onSuccess={(result) => {
              setVerificationPayload((prev) => prev ?? { kind: "idkit", idkitResponse: result });
              setVerifiedByBackend(true);
              setVerifyStatus("Verified.");
              setError("");
              setWidgetOpen(false);
              verifySucceededRef.current = true;
              logClient("Widget success", { protocol_version: (result as any)?.protocol_version ?? "unknown" });
            }}
            onError={(errorCode) => {
              const msg = idkitErrorMessage(errorCode);
              setError(msg);
              setVerifyStatus("");
              verifySucceededRef.current = false;
              logClient("IDKit widget error", { errorCode });
            }}
          />
        ) : null}

        <p className="hint">
          {verificationPayload
            ? verificationPayload.kind === "idkit"
              ? `✅ Proof captured (protocol ${(verificationPayload.idkitResponse as any).protocol_version})`
              : `✅ Proof captured (${verificationPayload.proof.verification_level})`
            : "Proof: not captured yet"}
        </p>
        <p className="hint">Backend verify: {verifiedByBackend ? "✅ success" : "pending"}</p>

        {verifiedByBackend ? (
          <>
            <button className="button secondary" type="button" onClick={captureGpsLocation} disabled={busyGps}>
              {busyGps ? "Capturing GPS..." : gpsLocation ? "Refresh GPS location" : "Capture GPS location"}
            </button>
            <p className="hint">
              {gpsLocation
                ? `GPS: ${gpsLocation.latitude.toFixed(6)}, ${gpsLocation.longitude.toFixed(6)}`
                : "GPS location not captured yet."}
            </p>
          </>
        ) : null}

        {/* Sign + upload */}
        <div className="row two">
          <button
            className="button"
            disabled={busySign || busyUpload || !verifiedByBackend || !gpsLocation}
            onClick={submit}
          >
            {busySign ? "Proving..." : "Prove humanity"}
          </button>
          <button
            className="button"
            disabled={busySign || busyOg || !signedPayload}
            onClick={publishOg}
          >
            {busyOg ? "Submitting..." : "Submit to 0G"}
          </button>
          <button
            className="button"
            disabled={busySign || busyUpload || !signedPayload}
            onClick={upload}
          >
            {busyUpload ? "Submitting..." : "Submit to backend"}
          </button>
        </div>
        <p className="hint">Signature: {signedPayload ? "✅ created" : "not created yet"}</p>

        {file ? <p className="hint">File: {file.name}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {apiFailure ? (
          <div className="result">
            <h2>API Failure</h2>
            <pre>{JSON.stringify(apiFailure, null, 2)}</pre>
          </div>
        ) : null}

        {actionResult ? (
          <div className="result">
            <h2>Result</h2>
            <pre>{JSON.stringify(actionResult, null, 2)}</pre>
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

function extractMiniKitProof(payload: MiniAppVerifySuccessPayload): MiniAppProof {
  if ("verifications" in payload) {
    const orbProof =
      payload.verifications.find((verification) => verification.verification_level === VerificationLevel.Orb) ??
      payload.verifications[0];
    if (!orbProof) {
      throw new Error("World App returned success without a verification payload.");
    }
    return {
      proof: orbProof.proof,
      merkle_root: orbProof.merkle_root,
      nullifier_hash: orbProof.nullifier_hash,
      verification_level: orbProof.verification_level,
    };
  }

  return {
    proof: payload.proof,
    merkle_root: payload.merkle_root,
    nullifier_hash: payload.nullifier_hash,
    verification_level: payload.verification_level,
  };
}
