import { NextResponse } from "next/server";
import { findUploadedImageByContentHash } from "../../../../../../src/image-store.ts";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ hash: string }> }) {
  const { hash } = await context.params;
  const normalizedHash = String(hash ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 400 });
  }

  const record = await findUploadedImageByContentHash(`sha256:${normalizedHash}`);
  if (!record) {
    return NextResponse.json({ error: "Image record not found" }, { status: 404 });
  }

  const bytes = Buffer.from(record.imageBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": record.imageMimeType || "image/jpeg",
      "cache-control": "public, max-age=300",
    },
  });
}
