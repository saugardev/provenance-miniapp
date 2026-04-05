import { ImageResponse } from "next/og";
import { findUploadedImageByContentHash } from "../../../../src/image-store.ts";

export const runtime = "nodejs";
export const alt = "Prove Reality - Real photo proof";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type RouteProps = {
  params: Promise<{ hash: string }>;
};

function normalizeHash(hash: string): string {
  return String(hash ?? "").trim().toLowerCase();
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}...${hash.slice(-10)}`;
}

async function findRecordSafe(normalizedHash: string) {
  try {
    return await findUploadedImageByContentHash(`sha256:${normalizedHash}`);
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: RouteProps) {
  const { hash } = await params;
  const normalizedHash = normalizeHash(hash);

  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "linear-gradient(140deg, #111 0%, #20252b 55%, #0f1419 100%)",
            color: "#f4f2ec",
            padding: "56px",
          }}
        >
          <div style={{ fontSize: 24, letterSpacing: 2, opacity: 0.8 }}>PROVE REALITY</div>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.05 }}>Invalid proof hash</div>
          <div style={{ fontSize: 24, opacity: 0.8 }}>Check the link and try again.</div>
        </div>
      ),
      size,
    );
  }

  const record = await findRecordSafe(normalizedHash);
  if (!record) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "linear-gradient(140deg, #111 0%, #20252b 55%, #0f1419 100%)",
            color: "#f4f2ec",
            padding: "56px",
          }}
        >
          <div style={{ fontSize: 24, letterSpacing: 2, opacity: 0.8 }}>PROVE REALITY</div>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.05 }}>Proof not found</div>
          <div style={{ fontSize: 24, opacity: 0.8 }}>No verified image attestation exists for this hash.</div>
        </div>
      ),
      size,
    );
  }

  const imageSrc = `data:${record.imageMimeType || "image/jpeg"};base64,${record.imageBase64}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: "#0f1114",
          position: "relative",
        }}
      >
        <img
          src={imageSrc}
          alt="Attested real photo"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 22,
            bottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.5)",
            color: "#f6f4ee",
            fontSize: 16,
            letterSpacing: 0.4,
          }}
        >
          <span style={{ fontWeight: 700 }}>PROVED</span>
          <span style={{ opacity: 0.88 }}>sha256:{shortHash(normalizedHash)}</span>
        </div>
      </div>
    ),
    size,
  );
}
