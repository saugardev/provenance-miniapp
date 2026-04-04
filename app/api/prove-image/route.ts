import { NextResponse } from "next/server";
import { findUploadedImageByContentHash } from "../../../src/image-store.ts";

export const runtime = "nodejs";

type ProveImageBody = {
  content_hash?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ProveImageBody;
    const contentHash = String(body?.content_hash ?? "").trim();
    if (!/^sha256:[0-9a-f]{64}$/i.test(contentHash)) {
      return NextResponse.json({ error: "content_hash must be sha256:<64 hex chars>" }, { status: 400 });
    }

    const record = await findUploadedImageByContentHash(contentHash);
    if (!record) {
      return NextResponse.json({
        ok: true,
        found: false,
        content_hash: contentHash,
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      prove_url: `/prove/${record.id}`,
      record: {
        id: record.id,
        created_at: record.createdAt,
        user_wallet_address: record.userWalletAddress,
        content_id: record.contentId,
        content_hash: record.contentHash,
        action: record.action,
        nullifier_hash: record.nullifierHash,
        verification_level: record.verificationLevel,
        merkle_root: record.merkleRoot,
        image_mime_type: record.imageMimeType,
        image_file_name: record.imageFileName,
        image_size_bytes: record.imageSizeBytes,
        image_base64: record.imageBase64,
        world_signature: {
          message: record.worldSignatureMessage,
          signature_b64: record.worldSignatureB64,
          public_key_pem: record.worldSignaturePublicKeyPem,
        },
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
