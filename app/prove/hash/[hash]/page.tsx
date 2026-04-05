import type { Metadata } from "next";
import Link from "next/link";
import { resolveBaseUrl } from "../../../../lib/base-url";
import { findUploadedImageByContentHash } from "../../../../src/image-store.ts";
import VerifyMediaButton from "./verify-media-button";
import styles from "./page.module.css";

type PageProps = {
  params: Promise<{ hash: string }>;
};

function normalizeHash(hash: string): string {
  return String(hash ?? "").trim().toLowerCase();
}

async function findRecordSafe(normalizedHash: string) {
  try {
    return await findUploadedImageByContentHash(`sha256:${normalizedHash}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { hash } = await params;
  const normalizedHash = normalizeHash(hash);
  const baseUrl = await resolveBaseUrl();
  const url = `${baseUrl}/prove/hash/${normalizedHash}`;

  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    return {
      title: "Invalid proof hash",
      description: "The provided proof hash is invalid.",
      openGraph: { title: "Invalid proof hash", description: "The provided proof hash is invalid.", url, type: "website" },
      twitter: { card: "summary", title: "Invalid proof hash", description: "The provided proof hash is invalid." },
    };
  }

  const record = await findRecordSafe(normalizedHash);
  if (!record) {
    return {
      title: "Proof not found",
      description: "No attested image found for this hash.",
      openGraph: { title: "Proof not found", description: "No attested image found for this hash.", url, type: "website" },
      twitter: { card: "summary", title: "Proof not found", description: "No attested image found for this hash." },
    };
  }

  const imageUrl = `${baseUrl}/prove/hash/${normalizedHash}/opengraph-image`;
  const title = "Real photo proof";
  const description = "This image hash matches a photo attested by a real World-verified human.";

  return {
    title,
    description,
    alternates: { canonical: `/prove/hash/${normalizedHash}` },
    openGraph: {
      title,
      description,
      url,
      type: "article",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Attested real photo" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ProveByHashPage({ params }: PageProps) {
  const { hash } = await params;
  const normalizedHash = normalizeHash(hash);

  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Invalid proof hash</h1>
          <p className={styles.subtitle}>The hash in this URL is invalid.</p>
          <Link href="/prove" className={styles.backLink}>Try another image</Link>
        </div>
      </main>
    );
  }

  const record = await findRecordSafe(normalizedHash);
  if (!record) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Proof not found</h1>
          <p className={styles.subtitle}>No image proof exists for this hash.</p>
          <Link href="/prove" className={styles.backLink}>Try another image</Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Real-user image proof</h1>
        <p className={styles.subtitle}>
          This page proves the image hash is tied to a World-verified human attestation and a backend signature.
        </p>

        <div className={styles.grid}>
          <section className={styles.card}>
            <p className={styles.label}>Image</p>
            <img
              alt="Attested real photo"
              src={`data:${record.imageMimeType};base64,${record.imageBase64}`}
              className={styles.image}
            />
          </section>

          <section className={styles.card}>
            <p className={styles.label}>Attestation</p>
            <p className={styles.monoLine}>sha256:{normalizedHash}</p>
            <p className={styles.kv}>
              Wallet: <code>{record.userWalletAddress ?? "unknown"}</code>
              <br />
              Action: <code>{record.action}</code>
              <br />
              Verification level: <code>{record.verificationLevel}</code>
            </p>
            <VerifyMediaButton
              expectedHashHex={normalizedHash}
              imageBase64={record.imageBase64}
              signatureMessage={record.worldSignatureMessage}
              signatureB64={record.worldSignatureB64}
              publicKeyPem={record.worldSignaturePublicKeyPem}
            />
            <details style={{ marginTop: 14 }}>
              <summary>Signature details</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(
                  {
                    message: record.worldSignatureMessage,
                    signature_b64: record.worldSignatureB64,
                    public_key_pem: record.worldSignaturePublicKeyPem,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>
        </div>
      </div>
    </main>
  );
}
