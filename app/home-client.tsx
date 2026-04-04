"use client";

import { Bebas_Neue, Manrope } from "next/font/google";
import { MiniKit } from "@worldcoin/minikit-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function HomeClient({ showDevButton }: { showDevButton: boolean }) {
  const APP_ID = (process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID ?? "") as `app_${string}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authAddress, setAuthAddress] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = "auto";
    video.play().catch(() => {
      // Autoplay can be blocked by some webviews; keep solid dark fallback visible.
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await resp.json()) as { authenticated?: boolean; address?: string | null };
        if (!cancelled) {
          setAuthAddress(data?.authenticated ? data.address ?? null : null);
        }
      } catch {
        if (!cancelled) {
          setAuthAddress(null);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signInWithWallet() {
    setAuthBusy(true);
    setAuthError("");
    try {
      if (!APP_ID.startsWith("app_")) {
        throw new Error("NEXT_PUBLIC_WORLDCOIN_APP_ID is missing or invalid.");
      }

      const installResult =
        typeof window !== "undefined" && (window as Window & { MiniKit?: unknown }).MiniKit
          ? { success: true as const }
          : MiniKit.install(APP_ID);
      if (!installResult.success) {
        throw new Error(`MiniKit install failed: ${installResult.errorMessage}`);
      }

      const nonceResp = await fetch("/api/auth/nonce", { method: "GET", cache: "no-store" });
      const nonceJson = (await nonceResp.json()) as { nonce?: string; error?: string };
      if (!nonceResp.ok || !nonceJson?.nonce) {
        throw new Error(nonceJson?.error ?? `Nonce request failed (${nonceResp.status})`);
      }

      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce: nonceJson.nonce,
        statement: "Sign in to Prove Reality",
        expirationTime: new Date(Date.now() + 1000 * 60 * 60),
      });

      if (!finalPayload || finalPayload.status !== "success") {
        const code = finalPayload?.status === "error" ? finalPayload.error_code : "generic_error";
        throw new Error(`Wallet auth failed: ${code}`);
      }

      const completeResp = await fetch("/api/auth/complete-siwe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: finalPayload,
          nonce: nonceJson.nonce,
        }),
      });
      const completeJson = (await completeResp.json()) as { isValid?: boolean; address?: string; error?: string };
      if (!completeResp.ok || !completeJson?.isValid || !completeJson?.address) {
        throw new Error(completeJson?.error ?? `SIWE verification failed (${completeResp.status})`);
      }

      setAuthAddress(completeJson.address);
      setAuthChecked(true);
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logoutWalletSession() {
    setAuthBusy(true);
    setAuthError("");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setAuthAddress(null);
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className={styles.hero}>
      <div className={manrope.className}>
        {showDevButton ? (
          <Link href="/verify" className={styles.heroDevButton}>
            Dev
          </Link>
        ) : null}

        <video
          ref={videoRef}
          className={[
            styles.heroVideo,
            videoReady ? styles.videoReady : styles.videoLoading,
            videoFailed ? styles.videoHidden : "",
          ].join(" ")}
          src="/hero-bg.webm"
          preload="none"
          muted
          loop
          playsInline
          autoPlay
          aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
        />
        <div className={styles.heroOverlay} />

        <div className={styles.heroContent}>
          <p className={styles.heroEyebrow}>Human-verified imagery</p>
          <h1 className={`${styles.heroTitle} ${bebasNeue.className}`}>
            Prove
            <br />
            reality
          </h1>
          <p className={styles.heroSubtitle}>Prove your photos are real and defend yourself from AI</p>
          {authAddress ? (
            <Link href="/capture" className={styles.heroCta}>
              Prove humanity
            </Link>
          ) : (
            <button
              type="button"
              className={styles.heroCta}
              disabled={authBusy || !authChecked}
              onClick={signInWithWallet}
            >
              {authBusy ? "Signing in..." : !authChecked ? "Loading..." : "Sign in with wallet"}
            </button>
          )}
          {authAddress ? (
            <div className={styles.heroSessionRow}>
              <p className={styles.heroSessionText}>Signed in once as {shortAddress(authAddress)}</p>
              <button
                type="button"
                className={styles.heroSessionButton}
                onClick={logoutWalletSession}
              >
                Sign out
              </button>
            </div>
          ) : null}
          {authError ? <p className={styles.heroAuthError}>{authError}</p> : null}
          <p className={styles.heroTerms}>
            By pressing &ldquo;Prove humanity&rdquo; you accept our <Link href="/terms">Terms and Conditions</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 8)}...${address.slice(-4)}` : address;
}
