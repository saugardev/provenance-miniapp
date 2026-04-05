import type { Metadata } from "next";
import Link from "next/link";
import { resolveBaseUrl } from "../../../lib/base-url";
import { findUploadedImageById } from "../../../src/image-store.ts";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = Number(rawId);
  const record = await findUploadedImageById(id);
  const baseUrl = await resolveBaseUrl();
  const url = `${baseUrl}/prove/${rawId}`;

  if (!record) {
    return {
      title: "Proof not found",
      description: "No attested image record found.",
      openGraph: { title: "Proof not found", description: "No attested image record found.", url, type: "website" },
      twitter: { card: "summary", title: "Proof not found", description: "No attested image record found." },
    };
  }

  const imageUrl = `${baseUrl}/api/prove-image/${record.id}/image`;
  const title = "Real photo proof";
  const description = `This image was attested by a real World-verified human. Proof record #${record.id}.`;

  return {
    title,
    description,
    alternates: { canonical: `/prove/${record.id}` },
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

export default async function ProveByIdPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  const record = await findUploadedImageById(id);

  if (!record) {
    return (
      <main style={{ minHeight: "100dvh", background: "#0c0c0d", color: "#f5f3ef", padding: 20 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h1>Proof not found</h1>
          <p>No image proof exists for this record.</p>
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
          Record #{record.id} attested by wallet <code>{record.userWalletAddress ?? "unknown"}</code>.
        </p>
        <p style={{ color: "rgba(245,243,239,0.72)" }}>
          Hash: <code>{record.contentHash}</code>
          <br />
          Action: <code>{record.action}</code>
          <br />
          Verification level: <code>{record.verificationLevel}</code>
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
