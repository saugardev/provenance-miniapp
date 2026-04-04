"use client";

import { Bebas_Neue, DM_Sans } from "next/font/google";
import Link from "next/link";
import { useEffect, useRef } from "react";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
});

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = "auto";
    video.play().catch(() => {/* autoplay blocked — stays as dark bg */});
  }, []);

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .hero {
          position: relative;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 0 24px 52px;
          overflow: hidden;
          background: #000;
        }

        .hero-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0.72;
          pointer-events: none;
          z-index: 0;
        }

        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(0,0,0,0.18) 0%,
            rgba(0,0,0,0.10) 30%,
            rgba(0,0,0,0.55) 65%,
            rgba(0,0,0,0.82) 100%
          );
          z-index: 1;
        }

        .hero-content {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 480px;
          text-align: left;
        }

        .hero-eyebrow {
          font-family: ${JSON.stringify(dmSans.style.fontFamily)};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.55);
          margin: 0 0 12px;
          animation: fadeUp 0.7s ease both;
          animation-delay: 0.1s;
        }

        .hero-title {
          font-family: ${JSON.stringify(bebasNeue.style.fontFamily)};
          font-size: clamp(72px, 22vw, 108px);
          font-weight: 400;
          line-height: 0.92;
          letter-spacing: 0.01em;
          color: #fff;
          margin: 0 0 20px;
          animation: fadeUp 0.7s ease both;
          animation-delay: 0.22s;
        }

        .hero-subtitle {
          font-family: ${JSON.stringify(dmSans.style.fontFamily)};
          font-size: 16px;
          font-weight: 400;
          line-height: 1.55;
          color: rgba(255,255,255,0.72);
          margin: 0 0 36px;
          max-width: 320px;
          animation: fadeUp 0.7s ease both;
          animation-delay: 0.34s;
        }

        .hero-cta {
          display: block;
          width: 100%;
          padding: 17px 24px;
          border-radius: 999px;
          border: none;
          background: #fff;
          color: #000;
          font-family: ${JSON.stringify(dmSans.style.fontFamily)};
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.01em;
          text-align: center;
          text-decoration: none;
          cursor: pointer;
          animation: fadeUp 0.7s ease both;
          animation-delay: 0.46s;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }

        .hero-cta:active {
          opacity: 0.85;
          transform: scale(0.98);
        }

        .hero-terms {
          font-family: ${JSON.stringify(dmSans.style.fontFamily)};
          font-size: 11px;
          color: rgba(255,255,255,0.38);
          text-align: center;
          margin: 14px 0 0;
          line-height: 1.5;
          animation: fadeUp 0.7s ease both;
          animation-delay: 0.56s;
        }

        .hero-terms a {
          color: rgba(255,255,255,0.55);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
      `}</style>

      <div className="hero">
        <video
          ref={videoRef}
          className="hero-video"
          src="/hero-bg.webm"
          preload="none"
          muted
          loop
          playsInline
          autoPlay
        />
        <div className="hero-overlay" />

        <div className="hero-content">
          <p className="hero-eyebrow">Human-verified imagery</p>
          <h1 className="hero-title">Prove<br />reality</h1>
          <p className="hero-subtitle">
            Prove your photos are real and defend yourself from AI
          </p>
          <Link href="/verify" className="hero-cta">
            Prove my reality
          </Link>
          <p className="hero-terms">
            By pressing &ldquo;Prove my reality&rdquo; you accept our{" "}
            <a href="#">Terms and Conditions</a>.
          </p>
        </div>
      </div>
    </>
  );
}
