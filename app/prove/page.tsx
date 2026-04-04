"use client";

import Link from "next/link";
import { Manrope } from "next/font/google";
import { useState } from "react";

const manrope = Manrope({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

type ProveResponse = {
  ok?: boolean;
  found?: boolean;
  prove_url?: string;
  content_hash?: string;
  record?: {
    id: number;
    created_at: string;
    user_wallet_address: string | null;
    content_id: string;
    content_hash: string;
    action: string;
    verification_level: string;
    image_mime_type: string;
    image_base64: string;
    world_signature: {
      message: string;
      signature_b64: string;
      public_key_pem: string;
    };
  };
  error?: string;
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function ProvePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [response, setResponse] = useState<ProveResponse | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError("");
    setResponse(null);
    setLocalPreview(URL.createObjectURL(file));

    try {
      const hash = await sha256Hex(file);
      const contentHash = `sha256:${hash}`;
      const resp = await fetch("/api/prove-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content_hash: contentHash }),
      });
      const data = (await resp.json()) as ProveResponse;
      setResponse(data);
      if (!resp.ok) setError(data.error ?? `Request failed (${resp.status})`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const found = Boolean(response?.found && response?.record);

  return (
    <main className={manrope.className} style={{ minHeight: "100dvh", background: "#0c0c0d", color: "#f5f3ef", padding: 20 }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Prove image authenticity</h1>
        <p style={{ color: "rgba(245,243,239,0.72)" }}>
          Upload an image. We hash it and check if it matches an image attested by a World-verified user.
        </p>

        <label
          style={{
            display: "inline-block",
            marginTop: 12,
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 999,
            padding: "12px 18px",
            cursor: "pointer",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          {busy ? "Checking..." : "Choose image"}
        </label>

        {error ? <p style={{ color: "#ffb3b3" }}>{error}</p> : null}

        {response ? (
          <section style={{ marginTop: 20, padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.04)" }}>
            <h2 style={{ marginTop: 0, fontSize: 20 }}>
              {found ? "Verified as real-user capture" : "No attestation found for this image"}
            </h2>
            <p style={{ margin: 0, color: "rgba(245,243,239,0.7)" }}>
              Hash: <code>{response.content_hash ?? response.record?.content_hash ?? "n/a"}</code>
            </p>
            {found && response.record ? (
              <>
                <p style={{ marginTop: 10, color: "rgba(245,243,239,0.7)" }}>
                  Wallet: <code>{response.record.user_wallet_address ?? "unknown"}</code>
                  <br />
                  Action: <code>{response.record.action}</code>
                  <br />
                  Verification level: <code>{response.record.verification_level}</code>
                </p>
                <details style={{ marginTop: 8 }}>
                  <summary>Signature details</summary>
                  <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(response.record.world_signature, null, 2)}</pre>
                </details>
                {response.prove_url ? (
                  <p style={{ marginTop: 10 }}>
                    Public proof page:{" "}
                    <Link href={response.prove_url} style={{ color: "#fff", textDecoration: "underline" }}>
                      {response.prove_url}
                    </Link>
                  </p>
                ) : null}
                <img
                  alt="Stored attested image"
                  src={`data:${response.record.image_mime_type};base64,${response.record.image_base64}`}
                  style={{ marginTop: 14, width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 12 }}
                />
              </>
            ) : null}
          </section>
        ) : null}

        {localPreview ? (
          <section style={{ marginTop: 18 }}>
            <p style={{ margin: "0 0 8px", color: "rgba(245,243,239,0.68)" }}>Uploaded image preview</p>
            <img src={localPreview} alt="Uploaded for verification" style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 12 }} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
