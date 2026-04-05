import type { Metadata } from "next";
import Link from "next/link";
import { findUploadedImageByContentHash } from "../../../../src/image-store.ts";

type PageProps = {
  params: Promise<{ hash: string }>;
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function normalizeHash(hash: string): string {
  return String(hash ?? "").trim().toLowerCase();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { hash } = await params;
  const normalizedHash = normalizeHash(hash);
  const url = `${baseUrl()}/prove/hash/${normalizedHash}`;

  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    return {
      title: "Invalid proof hash",
      description: "The provided proof hash is invalid.",
      openGraph: { title: "Invalid proof hash", description: "The provided proof hash is invalid.", url, type: "website" },
      twitter: { card: "summary", title: "Invalid proof hash", description: "The provided proof hash is invalid." },
    };
  }

  const record = await findUploadedImageByContentHash(`sha256:${normalizedHash}`);
  if (!record) {
    return {
      title: "Proof not found",
      description: "No attested image found for this hash.",
      openGraph: { title: "Proof not found", description: "No attested image found for this hash.", url, type: "website" },
      twitter: { card: "summary", title: "Proof not found", description: "No attested image found for this hash." },
    };
  }

  const imageUrl = `${baseUrl()}/api/prove-image/hash/${normalizedHash}/image`;
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
      <main style={{ minHeight: "100dvh", background: "#0c0c0d", color: "#f5f3ef", padding: 20 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h1>Invalid proof hash</h1>
          <p>The hash in this URL is invalid.</p>
          <Link href="/prove" style={{ color: "#fff" }}>Try another image</Link>
        </div>
      </main>
    );
  }

  const record = await findUploadedImageByContentHash(`sha256:${normalizedHash}`);
  if (!record) {
    return (
      <main style={{ minHeight: "100dvh", background: "#0c0c0d", color: "#f5f3ef", padding: 20 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h1>Proof not found</h1>
          <p>No image proof exists for this hash.</p>
          <Link href="/prove" style={{ color: "#fff" }}>Try another image</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100dvh", background: "#0c0c0d", color: "#f5f3ef", padding: 20 }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Real-user image proof</h1>
        <p style={{ color: "rgba(245,243,239,0.72)" }}>
          Hash <code>sha256:{normalizedHash}</code> is attested by wallet <code>{record.userWalletAddress ?? "unknown"}</code>.
        </p>
        <p style={{ color: "rgba(245,243,239,0.72)" }}>
          Action: <code>{record.action}</code>
          <br />
          Verification level: <code>{record.verificationLevel}</code>
          <br />
          Record id: <code>{record.id}</code>
        </p>
        <img
          alt="Attested real photo"
          src={`data:${record.imageMimeType};base64,${record.imageBase64}`}
          style={{ width: "100%", maxHeight: 580, objectFit: "contain", borderRadius: 14 }}
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
      </div>
    </main>
  );
}
