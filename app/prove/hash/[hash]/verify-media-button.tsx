"use client";

import { useState } from "react";

type Props = {
  expectedHashHex: string;
  imageBase64: string;
  signatureMessage: string;
  signatureB64: string;
  publicKeyPem: string;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function pemToSpkiBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64ToBytes(b64);
}

function hashInsideSignedMessage(message: string): string | null {
  const parts = message.split("|");
  if (parts.length < 2) return null;
  const hash = String(parts[1] ?? "");
  if (!/^sha256:[0-9a-f]{64}$/i.test(hash)) return null;
  return hash.replace(/^sha256:/i, "").toLowerCase();
}

export default function VerifyMediaButton({
  expectedHashHex,
  imageBase64,
  signatureMessage,
  signatureB64,
  publicKeyPem,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<
    Array<{ label: string; ok: boolean; detail: string }>
  >([]);

  async function verifyMedia() {
    setBusy(true);
    setSummary("");
    setSteps([]);

    try {
      const bytes = base64ToBytes(imageBase64);
      const computed = await sha256Hex(bytes);

      const stepResults: Array<{ label: string; ok: boolean; detail: string }> = [];

      const urlHashOk = computed.toLowerCase() === expectedHashHex.toLowerCase();
      stepResults.push({
        label: "Image hash matches URL hash",
        ok: urlHashOk,
        detail: `expected=${expectedHashHex}, computed=${computed}`,
      });

      const signedHash = hashInsideSignedMessage(signatureMessage);
      const messageHashOk = signedHash === computed.toLowerCase();
      stepResults.push({
        label: "Signed message binds the same hash",
        ok: Boolean(messageHashOk),
        detail: `message_hash=${signedHash ?? "n/a"}`,
      });

      let signatureOk = false;
      try {
        const publicKey = await crypto.subtle.importKey(
          "spki",
          toArrayBuffer(pemToSpkiBytes(publicKeyPem)),
          "Ed25519",
          false,
          ["verify"],
        );
        signatureOk = await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          toArrayBuffer(base64ToBytes(signatureB64)),
          toArrayBuffer(textToBytes(signatureMessage)),
        );
      } catch (err) {
        stepResults.push({
          label: "Signature verification",
          ok: false,
          detail: `Unavailable in this browser: ${String(err)}`,
        });
      }
      if (stepResults.length < 3) {
        stepResults.push({
          label: "Signature verification",
          ok: signatureOk,
          detail: signatureOk ? "Ed25519 signature is valid for message/public key." : "Signature check failed.",
        });
      }

      const allOk = stepResults.every((s) => s.ok);
      setSummary(allOk ? "Verified: this media matches the attested proof." : "Verification failed on one or more checks.");
      setSteps(stepResults);
    } catch (err) {
      setSummary(`Verification error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={verifyMedia}
        disabled={busy}
        style={{
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          borderRadius: 999,
          padding: "10px 16px",
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Verifying..." : "Verify media"}
      </button>
      {summary ? <p style={{ marginTop: 10, color: summary.startsWith("Verified") ? "#b9ffc9" : "#ffb3b3" }}>{summary}</p> : null}
      {steps.length ? (
        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
          {steps.map((step) => (
            <li key={step.label} style={{ color: step.ok ? "#b9ffc9" : "#ffb3b3", marginBottom: 6 }}>
              <strong>{step.label}:</strong> {step.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
