"use client";

import { IDKitErrorCodes, IDKitRequestWidget, orbLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { MiniKit, VerificationLevel, type MiniAppVerifyActionPayload } from "@worldcoin/minikit-js";
import { Bebas_Neue, Manrope } from "next/font/google";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

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

type MiniAppProof = {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
};

type VerificationPayload =
  | { kind: "idkit"; idkitResponse: IDKitResult }
  | { kind: "minikit"; proof: MiniAppProof };

type MiniAppVerifySuccessPayload = Extract<MiniAppVerifyActionPayload, { status: "success" }>;

type GpsLocation = {
  latitude: number;
  longitude: number;
  accuracy_meters?: number;
  captured_at_ms: number;
};

type CapturePayload = {
  previewUrl: string;
  base64: string;
  contentHash: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  gps: GpsLocation;
  capturedAtLabel: string;
};

const bebasNeue = Bebas_Neue({ weight: "400", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ weight: ["400", "500", "700"], subsets: ["latin"], display: "swap" });

const IDKIT_ERROR_MESSAGES: Record<string, string> = {
  [IDKitErrorCodes.InclusionProofPending]: "Your orb verification is still being confirmed. Try again later.",
  [IDKitErrorCodes.InclusionProofFailed]: "Inclusion proof check failed. Your verification may not be registered yet.",
  [IDKitErrorCodes.CredentialUnavailable]: "No matching World ID credential found.",
  [IDKitErrorCodes.UserRejected]: "You rejected verification in World App.",
  [IDKitErrorCodes.VerificationRejected]: "Verification was rejected by World App.",
  [IDKitErrorCodes.MaxVerificationsReached]: "You have reached max verifications for this action.",
  [IDKitErrorCodes.ConnectionFailed]: "Could not connect to World App.",
  [IDKitErrorCodes.Timeout]: "Verification timed out. Please try again.",
  [IDKitErrorCodes.Cancelled]: "Verification was cancelled.",
  [IDKitErrorCodes.GenericError]: "Unexpected World App error.",
};

function idkitErrorMessage(code: string): string {
  return IDKIT_ERROR_MESSAGES[code] ?? `World ID error: ${code}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getGpsPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

export default function CapturePage() {
  const ACTION = (process.env.NEXT_PUBLIC_WORLDCOIN_ACTION ?? "upload-photo").trim();
  const APP_ID = (process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "") as `app_${string}`;
  const USE_MINIKIT = process.env.NEXT_PUBLIC_WORLDCOIN_USE_MINIKIT === "true";

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [busyCamera, setBusyCamera] = useState(false);
  const [busyCapture, setBusyCapture] = useState(false);
  const [capture, setCapture] = useState<CapturePayload | null>(null);

  const [verificationPayload, setVerificationPayload] = useState<VerificationPayload | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("");
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const verifySucceededRef = useRef(false);

  const [busySign, setBusySign] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [signedPayload, setSignedPayload] = useState<unknown>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [denyStorageConsent, setDenyStorageConsent] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (capture?.previewUrl) URL.revokeObjectURL(capture.previewUrl);
    };
  }, [capture?.previewUrl]);

  async function openCameraWithPermissionCheck() {
    setBusyCamera(true);
    setError("");
    try {
      await getGpsPosition();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (err) {
      setError(`Camera/GPS permission is required: ${String(err)}`);
      setCameraReady(false);
    } finally {
      setBusyCamera(false);
    }
  }

  async function capturePhotoNow() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady) return;

    setBusyCapture(true);
    setError("");
    setResult(null);
    setSignedPayload(null);
    setVerificationPayload(null);
    setVerifiedByBackend(false);
    setVerifyStatus("");
    setWidgetOpen(false);
    setRpContext(null);
    verifySucceededRef.current = false;

    try {
      const position = await getGpsPosition();

      const width = video.videoWidth || 1080;
      const height = video.videoHeight || 1920;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not access camera frame.");
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) reject(new Error("Failed to capture photo."));
          else resolve(b);
        }, "image/jpeg", 0.92);
      });

      const hash = await sha256Hex(blob);
      const contentHash = `sha256:${hash}`;
      const base64 = arrayBufferToBase64(await blob.arrayBuffer());
      const capturedAtMs = Math.round(position.timestamp || Date.now());
      const fileName = `capture-${new Date(capturedAtMs).toISOString().replace(/[:.]/g, "-")}.jpg`;

      if (capture?.previewUrl) URL.revokeObjectURL(capture.previewUrl);
      setCapture({
        previewUrl: URL.createObjectURL(blob),
        base64,
        contentHash,
        mimeType: "image/jpeg",
        fileName,
        fileSize: blob.size,
        capturedAtLabel: new Date(capturedAtMs).toLocaleTimeString(),
        gps: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          captured_at_ms: capturedAtMs,
        },
      });
    } catch (err) {
      setError(`Capture failed: ${String(err)}`);
    } finally {
      setBusyCapture(false);
    }
  }

  async function verifyHumanity() {
    if (!capture) {
      setError("Capture a photo first.");
      return;
    }

    setBusyVerify(true);
    setError("");
    setVerificationPayload(null);
    setVerifiedByBackend(false);
    setWidgetOpen(false);
    setRpContext(null);
    verifySucceededRef.current = false;

    try {
      if (!APP_ID.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is not set correctly.");
      }

      const isWorldApp =
        USE_MINIKIT &&
        typeof window !== "undefined" &&
        Boolean((window as Window & { WorldApp?: unknown }).WorldApp);

      if (isWorldApp) {
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
          signal: capture.contentHash,
          verification_level: VerificationLevel.Orb,
        });
        if (!finalPayload || finalPayload.status !== "success") {
          const errorCode = finalPayload?.status === "error" ? finalPayload.error_code : "generic_error";
          throw new Error(idkitErrorMessage(errorCode));
        }

        const proof = extractMiniKitProof(finalPayload);
        setVerifyStatus("Checking proof...");
        const verifyResp = await fetch("/api/verify-proof", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof, action: ACTION, signal: capture.contentHash }),
        });
        const verifyJson = await verifyResp.json();
        if (!verifyResp.ok || !verifyJson?.success) {
          throw new Error(`Backend verification failed: ${JSON.stringify(verifyJson?.detail ?? verifyJson)}`);
        }

        setVerificationPayload({ kind: "minikit", proof });
        setVerifiedByBackend(true);
        setVerifyStatus("Verified.");
        return;
      }

      setVerifyStatus("Fetching RP signature...");
      const rpResp = await fetch("/api/rp-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: ACTION, ttl_seconds: 900 }),
      });
      if (!rpResp.ok) {
        throw new Error(`RP signature failed: ${JSON.stringify(await rpResp.json().catch(() => ({})))}`);
      }
      const rp = (await rpResp.json()) as RpSignatureResponse;
      setRpContext({
        rp_id: rp.rp_id,
        nonce: rp.nonce,
        created_at: rp.created_at,
        expires_at: rp.expires_at,
        signature: rp.sig,
      });
      setWidgetOpen(true);
      setVerifyStatus("Awaiting confirmation in World App...");
    } catch (err) {
      setError(String(err));
      setVerifyStatus("");
    } finally {
      setBusyVerify(false);
    }
  }

  async function proveHumanity() {
    if (!capture || !verificationPayload || !verifiedByBackend) {
      setError("Verify with World ID first.");
      return;
    }

    setBusySign(true);
    setError("");
    setResult(null);

    try {
      const contentId = `capture-${capture.gps.captured_at_ms}`;
      const resp = await fetch("/api/sign-provenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_id: contentId,
          content_hash: capture.contentHash,
          timestamp_ms: Date.now(),
          gps_location: capture.gps,
          ...(verificationPayload.kind === "idkit"
            ? { idkitResponse: verificationPayload.idkitResponse }
            : { proof: verificationPayload.proof }),
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setResult(data);
      if (resp.ok && data.payload) setSignedPayload(data.payload);
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusySign(false);
    }
  }

  async function uploadImage() {
    if (!capture || !signedPayload) {
      setError("Prove humanity first.");
      return;
    }
    if (denyStorageConsent) {
      setError("Storage consent denied. Upload blocked.");
      return;
    }

    setBusyUpload(true);
    setError("");
    setResult(null);

    try {
      const resp = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_payload: signedPayload,
          consent_to_store_image: true,
          consent_scope: "ethglobal_hackathon",
          image_base64: capture.base64,
          image_mime_type: capture.mimeType,
          image_file_name: capture.fileName,
          image_size_bytes: capture.fileSize,
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setResult(data);
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyUpload(false);
    }
  }

  return (
    <main className={`${styles.page} ${manrope.className}`}>
      <canvas ref={canvasRef} className={styles.hidden} />
      <div className={styles.headerRow}>
        <h1 className={`${styles.title} ${bebasNeue.className}`}>Capture truth</h1>
        <Link className={styles.techLink} href="/verify">Technical mode</Link>
      </div>

      <p className={styles.subtitle}>Use your camera to capture a real moment, prove humanity, then choose to upload.</p>

      <section className={styles.cameraPanel}>
        <video ref={videoRef} playsInline muted autoPlay className={`${styles.video} ${cameraReady ? "" : styles.hidden}`} />
        {!cameraReady && !capture ? (
          <div className={styles.placeholder}>Camera is off</div>
        ) : null}
        {capture ? <img src={capture.previewUrl} alt="Captured" className={styles.video} /> : null}
      </section>

      <div className={styles.actions}>
        <button className={styles.secondary} disabled={busyCamera || busyCapture} onClick={openCameraWithPermissionCheck}>
          {busyCamera ? "Enabling..." : cameraReady ? "Re-open camera" : "Enable camera"}
        </button>
        <button className={styles.primary} disabled={!cameraReady || busyCapture} onClick={capturePhotoNow}>
          {busyCapture ? "Capturing..." : "Capture image"}
        </button>
      </div>

      {capture ? (
        <p className={styles.caption}>
          Captured at {capture.capturedAtLabel} • GPS {capture.gps.latitude.toFixed(5)}, {capture.gps.longitude.toFixed(5)}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button className={styles.primary} disabled={!capture || busyVerify} onClick={verifyHumanity}>
          {busyVerify ? "Verifying..." : "Verify with World ID"}
        </button>
        <button className={styles.primary} disabled={!verifiedByBackend || busySign || !capture} onClick={proveHumanity}>
          {busySign ? "Proving..." : "Prove humanity"}
        </button>
      </div>

      {verifyStatus ? <p className={styles.caption}>{verifyStatus}</p> : null}
      <p className={styles.caption}>Verification: {verifiedByBackend ? "Verified" : "Not verified"}</p>
      <p className={styles.caption}>Signature: {signedPayload ? "Created" : "Not created"}</p>

      <label className={styles.consent}>
        <input
          type="checkbox"
          checked={denyStorageConsent}
          onChange={(e) => setDenyStorageConsent(e.target.checked)}
        />
        <span>I do not consent to storing this image for ETHGlobal purposes.</span>
      </label>

      <div className={styles.actions}>
        <button className={styles.primary} disabled={!signedPayload || denyStorageConsent || busyUpload} onClick={uploadImage}>
          {busyUpload ? "Uploading..." : "Upload image"}
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {result ? <pre className={styles.result}>{JSON.stringify(result, null, 2)}</pre> : null}

      {rpContext ? (
        <IDKitRequestWidget
          open={widgetOpen}
          onOpenChange={(open) => {
            setWidgetOpen(open);
            if (!open && !verifySucceededRef.current) {
              setVerifyStatus("");
              setError("Verification window closed before completion.");
            }
          }}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          preset={orbLegacy({ signal: capture?.contentHash ?? "" })}
          environment="production"
          polling={{ interval: 2000, timeout: 900000 }}
          autoClose={true}
          handleVerify={async (result) => {
            setVerifyStatus("Checking proof...");
            const verifyResp = await fetch("/api/verify-proof", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ rp_id: rpContext.rp_id, idkitResponse: result }),
            });
            const verifyJson = await verifyResp.json();
            if (!verifyResp.ok || !verifyJson?.success) {
              setVerifyStatus("");
              setError(`Backend verification failed: ${JSON.stringify(verifyJson?.detail ?? verifyJson)}`);
              throw new Error("Backend verification failed");
            }
            setVerificationPayload({ kind: "idkit", idkitResponse: result });
            setVerifiedByBackend(true);
            setVerifyStatus("Verified.");
            verifySucceededRef.current = true;
          }}
          onSuccess={(result) => {
            setVerificationPayload((prev) => prev ?? { kind: "idkit", idkitResponse: result });
            setVerifiedByBackend(true);
            setVerifyStatus("Verified.");
            setWidgetOpen(false);
            verifySucceededRef.current = true;
          }}
          onError={(errorCode) => {
            setError(idkitErrorMessage(errorCode));
            setVerifyStatus("");
            verifySucceededRef.current = false;
          }}
        />
      ) : null}
    </main>
  );
}

function extractMiniKitProof(payload: MiniAppVerifySuccessPayload): MiniAppProof {
  if ("verifications" in payload) {
    const orbProof =
      payload.verifications.find((verification) => verification.verification_level === VerificationLevel.Orb) ??
      payload.verifications[0];
    if (!orbProof) throw new Error("World App returned success without a verification payload.");
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
