"use client";

import { IDKitErrorCodes, IDKitRequestWidget, orbLegacy, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { MiniKit, VerificationLevel, type MiniAppVerifyActionPayload } from "@worldcoin/minikit-js";
import { Manrope } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  og_explorer_links?: string[];
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
type FacingMode = "environment" | "user";

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
  const drawerRef = useRef<HTMLElement | null>(null);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const dragStartedOpenRef = useRef(false);
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const overshootMaskTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [busyCamera, setBusyCamera] = useState(false);
  const [busyCapture, setBusyCapture] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<FacingMode>("environment");
  const [capture, setCapture] = useState<CapturePayload | null>(null);

  const [verificationPayload, setVerificationPayload] = useState<VerificationPayload | null>(null);
  const [verifiedByBackend, setVerifiedByBackend] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("");
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const verifySucceededRef = useRef(false);
  const autoSignAfterVerifyRef = useRef(false);

  const [busySign, setBusySign] = useState(false);
  const [busyOg, setBusyOg] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [signedPayload, setSignedPayload] = useState<unknown>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [ogExplorerLinks, setOgExplorerLinks] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDragOffset, setDrawerDragOffset] = useState<number | null>(null);
  const [overshootMaskHeight, setOvershootMaskHeight] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  const [error, setError] = useState("");

  const verifyStepState = verifiedByBackend ? "done" : busyVerify ? "active" : "idle";
  const signStepState = signedPayload ? "done" : busySign ? "active" : "idle";
  const uploadStepState = result?.uploaded ? "done" : busyUpload ? "active" : "idle";
  const proveCompleted = Boolean(result?.uploaded);
  const proveBusy = busyVerify || busySign || busyUpload;
  const proveButtonLabel = busyVerify
    ? "Verifying..."
    : busySign
      ? "Proving..."
      : busyUpload
        ? "Submitting..."
        : proveCompleted
          ? "Reality proved"
          : "Prove reality";

  async function getCameraStream(mode: FacingMode): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: mode } },
        audio: false,
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
    }
  }

  async function attachStream(stream: MediaStream, mode: FacingMode) {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setCameraFacingMode(mode);
    setCameraReady(true);
  }

  function hasLiveCameraStream() {
    const stream = streamRef.current;
    if (!stream) return false;
    return stream.getVideoTracks().some((track) => track.readyState === "live");
  }

  async function ensureLiveCameraPreview() {
    if (hasLiveCameraStream()) {
      setCameraReady(true);
      return;
    }
    setCameraReady(false);
    await openCameraWithPermissionCheck();
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (capture?.previewUrl) URL.revokeObjectURL(capture.previewUrl);
      if (overshootMaskTimeoutRef.current) clearTimeout(overshootMaskTimeoutRef.current);
    };
  }, [capture?.previewUrl]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 860px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 40) {
        setDrawerOpen(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    void openCameraWithPermissionCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getClosedDrawerOffset(): number {
    const drawerEl = drawerRef.current;
    if (!drawerEl) return 340;
    return Math.max(0, drawerEl.offsetHeight - 86);
  }

  function applyElasticBounds(rawOffset: number, closedOffset: number): number {
    if (rawOffset < 0) return rawOffset * 0.35;
    if (rawOffset > closedOffset) return closedOffset + (rawOffset - closedOffset) * 0.35;
    return rawOffset;
  }

  function onDrawerPointerDown(e: ReactPointerEvent<HTMLElement>) {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    draggedRef.current = false;
    dragStartedOpenRef.current = drawerOpen;
    dragStartYRef.current = e.clientY;
    dragStartOffsetRef.current = drawerOpen ? 0 : getClosedDrawerOffset();
    setDrawerDragOffset(dragStartOffsetRef.current);
  }

  function onDrawerPointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!draggingRef.current) return;
    const closedOffset = getClosedDrawerOffset();
    const deltaY = e.clientY - dragStartYRef.current;
    const rawOffset = dragStartOffsetRef.current + deltaY;
    if (Math.abs(deltaY) > 4) draggedRef.current = true;
    setDrawerDragOffset(applyElasticBounds(rawOffset, closedOffset));
  }

  function resetToCameraPreview() {
    if (capture?.previewUrl) {
      URL.revokeObjectURL(capture.previewUrl);
    }
    setCapture(null);
    setResult(null);
    setOgExplorerLinks([]);
    setSignedPayload(null);
    setVerificationPayload(null);
    setVerifiedByBackend(false);
    setVerifyStatus("");
    setWidgetOpen(false);
    setRpContext(null);
    setError("");
    verifySucceededRef.current = false;
    autoSignAfterVerifyRef.current = false;
  }

  function onDrawerPointerEnd() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const closedOffset = getClosedDrawerOffset();
    const finalOffset = drawerDragOffset ?? (drawerOpen ? 0 : closedOffset);
    const releasedOvershoot = finalOffset < 0 ? Math.abs(finalOffset) : 0;
    const clamped = Math.max(0, Math.min(closedOffset, finalOffset));
    const nextOpen = dragStartedOpenRef.current
      ? clamped < closedOffset * 0.35
      : clamped < closedOffset * 0.75;
    setDrawerOpen(nextOpen);
    setDrawerDragOffset(null);
    if (!nextOpen && capture) {
      resetToCameraPreview();
      void ensureLiveCameraPreview();
    }

    if (overshootMaskTimeoutRef.current) clearTimeout(overshootMaskTimeoutRef.current);
    if (releasedOvershoot > 0) {
      setOvershootMaskHeight(Math.ceil(releasedOvershoot) + 2);
      overshootMaskTimeoutRef.current = setTimeout(() => {
        setOvershootMaskHeight(0);
      }, 220);
    } else {
      setOvershootMaskHeight(0);
    }
  }

  const topOvershoot = drawerDragOffset !== null && drawerDragOffset < 0 ? Math.abs(drawerDragOffset) : 0;
  const underlayHeight = Math.max(topOvershoot > 0 ? Math.ceil(topOvershoot) + 2 : 0, overshootMaskHeight);

  async function openCameraWithPermissionCheck() {
    setBusyCamera(true);
    setError("");
    try {
      await getGpsPosition();
      const stream = await getCameraStream("environment");
      await attachStream(stream, "environment");
    } catch (err) {
      setError(`Camera/GPS permission is required: ${String(err)}`);
      setCameraReady(false);
    } finally {
      setBusyCamera(false);
    }
  }

  async function switchCamera() {
    if (!cameraReady || busyCamera || busyCapture) return;
    setBusyCamera(true);
    setError("");
    try {
      const nextMode: FacingMode = cameraFacingMode === "environment" ? "user" : "environment";
      const stream = await getCameraStream(nextMode);
      await attachStream(stream, nextMode);
    } catch (err) {
      setError(`Unable to switch camera: ${String(err)}`);
    } finally {
      setBusyCamera(false);
    }
  }

  async function captureFromBlob(blob: Blob, gps: GpsLocation) {
    const hash = await sha256Hex(blob);
    const contentHash = `sha256:${hash}`;
    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    const fileName = `capture-${new Date(gps.captured_at_ms).toISOString().replace(/[:.]/g, "-")}.jpg`;

    if (capture?.previewUrl) URL.revokeObjectURL(capture.previewUrl);
    setCapture({
      previewUrl: URL.createObjectURL(blob),
      base64,
      contentHash,
      mimeType: blob.type || "image/jpeg",
      fileName,
      fileSize: blob.size,
      capturedAtLabel: new Date(gps.captured_at_ms).toLocaleTimeString(),
      gps,
    });
    setDrawerOpen(true);
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

      const capturedAtMs = Math.round(position.timestamp || Date.now());
      await captureFromBlob(blob, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_meters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
        captured_at_ms: capturedAtMs,
      });
    } catch (err) {
      setError(`Capture failed: ${String(err)}`);
    } finally {
      setBusyCapture(false);
    }
  }

  async function quickPhoto() {
    if (!cameraReady) {
      await openCameraWithPermissionCheck();
      return;
    }
    await capturePhotoNow();
  }

  async function signProvenance(verification: VerificationPayload, photo: CapturePayload) {
    setBusySign(true);
    setError("");
    setResult(null);

    try {
      const contentId = `capture-${photo.gps.captured_at_ms}`;
      const resp = await fetch("/api/sign-provenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_id: contentId,
          content_hash: photo.contentHash,
          timestamp_ms: Date.now(),
          gps_location: photo.gps,
          ...(verification.kind === "idkit"
            ? { idkitResponse: verification.idkitResponse }
            : { proof: verification.proof }),
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setResult(data);
      if (resp.ok && data.payload) {
        setSignedPayload(data.payload);
        await uploadSignedPayloadToBackend(data.payload, photo);
      }
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusySign(false);
    }
  }

  async function verifyReality(autoSign = false) {
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
        if (autoSign) {
          await signProvenance({ kind: "minikit", proof }, capture);
        }
        return;
      }

      autoSignAfterVerifyRef.current = autoSign;
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
      autoSignAfterVerifyRef.current = false;
    } finally {
      setBusyVerify(false);
    }
  }

  async function proveReality() {
    if (!capture) {
      setError("Capture a photo first.");
      return;
    }
    if (!verifiedByBackend || !verificationPayload) {
      await verifyReality(true);
      return;
    }
    await signProvenance(verificationPayload, capture);
  }

  async function uploadSignedPayloadToBackend(payloadForUpload: unknown, photo: CapturePayload) {
    setBusyUpload(true);

    try {
      const resp = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_payload: payloadForUpload,
          consent_to_store_image: true,
          consent_scope: "ethglobal_hackathon",
          image_base64: photo.base64,
          image_mime_type: photo.mimeType,
          image_file_name: photo.fileName,
          image_size_bytes: photo.fileSize,
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

  async function publishToOg() {
    if (!signedPayload) {
      setError("Prove reality first.");
      return;
    }

    setBusyOg(true);
    setError("");
    setResult(null);

    try {
      const resp = await fetch("/api/publish-og", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signed_payload: signedPayload,
        }),
      });
      const data = (await resp.json()) as SubmitResponse;
      setResult(data);
      setOgExplorerLinks(Array.isArray(data.og_explorer_links) ? data.og_explorer_links.filter(Boolean) : []);
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyOg(false);
    }
  }

  function shareOnX() {
    const hashSlug = extractHashSlug(signedPayload) ?? (capture ? capture.contentHash.replace(/^sha256:/i, "") : null);
    if (!hashSlug || !/^[0-9a-f]{64}$/i.test(hashSlug)) {
      setError("No proven image hash available to share yet.");
      return;
    }
    const proofUrl = `${window.location.origin}/prove/hash/${hashSlug.toLowerCase()}`;
    const text = "I created a real picture. You can prove it here:";
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(proofUrl)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  async function copyShareLink() {
    const hashSlug = extractHashSlug(signedPayload) ?? (capture ? capture.contentHash.replace(/^sha256:/i, "") : null);
    if (!hashSlug || !/^[0-9a-f]{64}$/i.test(hashSlug)) {
      setError("No proven image hash available to share yet.");
      return;
    }

    const proofUrl = `${window.location.origin}/prove/hash/${hashSlug.toLowerCase()}`;
    try {
      await navigator.clipboard.writeText(proofUrl);
      setError("");
      setVerifyStatus("Share link copied.");
    } catch {
      setError("Could not copy the share link.");
    }
  }

  return (
    <main className={`${styles.page} ${manrope.className}`}>
      <canvas ref={canvasRef} className={styles.hidden} />

      <section className={styles.cameraPanel}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`${styles.mediaFrame} ${cameraReady && !capture ? "" : styles.hidden}`}
        />
        {!cameraReady && !capture ? (
          <div className={styles.placeholder}>Camera is off</div>
        ) : null}
        {capture ? <img src={capture.previewUrl} alt="Captured" className={styles.mediaFrame} /> : null}
        <div className={styles.cameraOverlay} />
      </section>

      <div className={styles.floatingCaptureControls}>
        <>
          <button
            className={styles.shutterButton}
            aria-label={busyCapture ? "Capturing photo" : cameraReady ? "Take photo" : "Request camera permissions"}
            disabled={busyCapture || busyCamera}
            onClick={quickPhoto}
          >
            <span className={styles.shutterInner} />
          </button>
          <button
            className={styles.switchCameraButton}
            type="button"
            onClick={switchCamera}
            aria-label="Switch camera"
            disabled={!cameraReady || busyCamera || busyCapture}
          >
            {busyCamera ? (
              "..."
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3" />
              </svg>
            )}
          </button>
        </>
      </div>

      <div className={styles.scrollPad} />

      {underlayHeight > 0 ? (
        <div
          className={styles.drawerUnderlay}
          style={{ height: `${underlayHeight}px` }}
          aria-hidden="true"
        />
      ) : null}

      <section
        ref={drawerRef}
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""} ${drawerDragOffset !== null ? styles.drawerDragging : ""}`}
        style={
          drawerDragOffset !== null
            ? { transform: isDesktop ? `translate(-50%, ${drawerDragOffset}px)` : `translateY(${drawerDragOffset}px)` }
            : undefined
        }
      >
        <button
          className={styles.drawerHandle}
          type="button"
          onClick={() => {
            if (draggedRef.current) return;
            setDrawerOpen((v) => {
              const next = !v;
              if (!next && capture) {
                resetToCameraPreview();
                void ensureLiveCameraPreview();
              }
              return next;
            });
          }}
          onPointerDown={onDrawerPointerDown}
          onPointerMove={onDrawerPointerMove}
          onPointerUp={onDrawerPointerEnd}
          onPointerCancel={onDrawerPointerEnd}
        >
          <span className={styles.drawerKnob} />
        </button>

        <div className={styles.drawerBody}>
          {capture ? (
            <p className={styles.caption}>
              Captured at {capture.capturedAtLabel} • GPS {capture.gps.latitude.toFixed(5)}, {capture.gps.longitude.toFixed(5)}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button className={styles.primary} disabled={!capture || proveBusy || proveCompleted} onClick={proveReality}>
              {proveButtonLabel}
            </button>
          </div>

          {capture ? (
            <div className={styles.progressSteps} aria-label="Proof progress">
              <div className={styles.progressStep}>
                <span
                  className={`${styles.progressCircle} ${
                    verifyStepState === "done"
                      ? styles.progressDone
                      : verifyStepState === "active"
                        ? styles.progressActive
                        : ""
                  }`}
                />
                <span className={styles.progressLabel}>Verify</span>
              </div>
              <span className={styles.progressConnector} aria-hidden="true" />
              <div className={styles.progressStep}>
                <span
                  className={`${styles.progressCircle} ${
                    signStepState === "done" ? styles.progressDone : signStepState === "active" ? styles.progressActive : ""
                  }`}
                />
                <span className={styles.progressLabel}>Sign</span>
              </div>
              <span className={styles.progressConnector} aria-hidden="true" />
              <div className={styles.progressStep}>
                <span
                  className={`${styles.progressCircle} ${
                    uploadStepState === "done"
                      ? styles.progressDone
                      : uploadStepState === "active"
                        ? styles.progressActive
                        : ""
                  }`}
                />
                <span className={styles.progressLabel}>Upload</span>
              </div>
            </div>
          ) : null}

          {verifyStatus ? <p className={styles.caption}>{verifyStatus}</p> : null}

          <div className={styles.actions}>
            <button className={styles.primary} disabled={!signedPayload || busyOg} onClick={publishToOg}>
              {busyOg ? "Submitting..." : "Submit to 0G"}
            </button>
            <button className={styles.secondary} disabled={!signedPayload} onClick={shareOnX}>
              Post on X
            </button>
            <button className={styles.secondary} disabled={!signedPayload} onClick={copyShareLink}>
              Share link
            </button>
          </div>

          {ogExplorerLinks[0] ? (
            <p className={styles.caption}>
              0G link:{" "}
              <a href={ogExplorerLinks[0]} target="_blank" rel="noreferrer" className={styles.techLink}>
                View on explorer
              </a>
            </p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </section>

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
            if (autoSignAfterVerifyRef.current && capture) {
              autoSignAfterVerifyRef.current = false;
              await signProvenance({ kind: "idkit", idkitResponse: result }, capture);
            }
          }}
          onSuccess={(result) => {
            setVerificationPayload((prev) => prev ?? { kind: "idkit", idkitResponse: result });
            setVerifiedByBackend(true);
            setVerifyStatus("Verified.");
            setWidgetOpen(false);
            verifySucceededRef.current = true;
            autoSignAfterVerifyRef.current = false;
          }}
          onError={(errorCode) => {
            setError(idkitErrorMessage(errorCode));
            setVerifyStatus("");
            verifySucceededRef.current = false;
            autoSignAfterVerifyRef.current = false;
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

function extractHashSlug(payload: unknown): string | null {
  const value = payload as { entry?: { content_hash?: string } } | null | undefined;
  const contentHash = String(value?.entry?.content_hash ?? "").trim();
  if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) return null;
  return contentHash.replace(/^sha256:/i, "");
}
