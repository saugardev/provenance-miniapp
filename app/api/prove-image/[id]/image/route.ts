import { NextResponse } from "next/server";
import { findUploadedImageById } from "../../../../../src/image-store.ts";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const record = await findUploadedImageById(id);
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
