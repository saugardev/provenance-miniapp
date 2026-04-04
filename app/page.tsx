"use client";

import { Bebas_Neue, Manrope } from "next/font/google";
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

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = "auto";
    video.play().catch(() => {
      // Autoplay can be blocked by some webviews; keep solid dark fallback visible.
    });
  }, []);

  return (
    <div className={styles.hero}>
      <div className={manrope.className}>
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
          <p className={styles.heroSubtitle}>
            Prove your photos are real and defend yourself from AI
          </p>
          <Link href="/verify" className={styles.heroCta}>
            Prove humanity
          </Link>
          <p className={styles.heroTerms}>
            By pressing &ldquo;Prove humanity&rdquo; you accept our{" "}
            <Link href="/terms">Terms and Conditions</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
