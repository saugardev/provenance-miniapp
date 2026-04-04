import { Pool } from "pg";

type PersistUploadedImageInput = {
  userWalletAddress: string;
  contentId: string;
  contentHash: string;
  action: string;
  nullifierHash: string;
  verificationLevel: string;
  merkleRoot: string;
  imageBase64: string;
  imageMimeType: string;
  imageFileName: string | null;
  imageSizeBytes: number;
  gpsLocation?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
    captured_at_ms?: number;
  };
  consentToStoreImage: boolean;
  consentScope: string;
  provenancePayload: unknown;
};

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to store uploaded images.");
  }
  pool = new Pool({ connectionString });
  return pool;
}

async function ensureSchema(client: Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS uploaded_images (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_wallet_address TEXT,
      content_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      nullifier_hash TEXT NOT NULL,
      verification_level TEXT NOT NULL,
      merkle_root TEXT,
      image_mime_type TEXT NOT NULL,
      image_file_name TEXT,
      image_size_bytes INTEGER NOT NULL,
      image_bytes BYTEA NOT NULL,
      gps_latitude DOUBLE PRECISION,
      gps_longitude DOUBLE PRECISION,
      gps_accuracy_meters DOUBLE PRECISION,
      gps_captured_at_ms BIGINT,
      consent_to_store_image BOOLEAN NOT NULL,
      consent_scope TEXT NOT NULL,
      provenance_payload JSONB NOT NULL
    );
  `);
  await client.query(
    "ALTER TABLE uploaded_images ADD COLUMN IF NOT EXISTS user_wallet_address TEXT",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS uploaded_images_nullifier_action_idx ON uploaded_images (nullifier_hash, action)",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS uploaded_images_user_wallet_idx ON uploaded_images (user_wallet_address)",
  );
}

export async function persistUploadedImage(input: PersistUploadedImageInput): Promise<number> {
  const db = getPool();
  await ensureSchema(db);

  const imageBytes = Buffer.from(input.imageBase64, "base64");
  if (!imageBytes.length) {
    throw new Error("Decoded image bytes are empty.");
  }

  const insert = await db.query<{ id: string }>(
    `
      INSERT INTO uploaded_images (
        user_wallet_address,
        content_id,
        content_hash,
        action,
        nullifier_hash,
        verification_level,
        merkle_root,
        image_mime_type,
        image_file_name,
        image_size_bytes,
        image_bytes,
        gps_latitude,
        gps_longitude,
        gps_accuracy_meters,
        gps_captured_at_ms,
        consent_to_store_image,
        consent_scope,
        provenance_payload
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING id
    `,
    [
      input.userWalletAddress,
      input.contentId,
      input.contentHash,
      input.action,
      input.nullifierHash,
      input.verificationLevel,
      input.merkleRoot,
      input.imageMimeType,
      input.imageFileName,
      input.imageSizeBytes,
      imageBytes,
      input.gpsLocation?.latitude ?? null,
      input.gpsLocation?.longitude ?? null,
      input.gpsLocation?.accuracy_meters ?? null,
      input.gpsLocation?.captured_at_ms ?? null,
      input.consentToStoreImage,
      input.consentScope,
      JSON.stringify(input.provenancePayload),
    ],
  );

  return Number(insert.rows[0]?.id ?? 0);
}

export type UploadedImageProofRecord = {
  id: number;
  createdAt: string;
  userWalletAddress: string | null;
  contentId: string;
  contentHash: string;
  action: string;
  nullifierHash: string;
  verificationLevel: string;
  merkleRoot: string | null;
  imageMimeType: string;
  imageFileName: string | null;
  imageSizeBytes: number;
  imageBase64: string;
  provenancePayload: unknown;
  worldSignatureMessage: string;
  worldSignatureB64: string;
  worldSignaturePublicKeyPem: string;
};

type UploadedImageRow = {
  id: string;
  created_at: string;
  user_wallet_address: string | null;
  content_id: string;
  content_hash: string;
  action: string;
  nullifier_hash: string;
  verification_level: string;
  merkle_root: string | null;
  image_mime_type: string;
  image_file_name: string | null;
  image_size_bytes: number;
  image_bytes: Buffer;
  provenance_payload: unknown;
};

function mapUploadedImageRow(row: UploadedImageRow): UploadedImageProofRecord {
  const payload = row.provenance_payload as {
    world_signature?: {
      message?: string;
      signature_b64?: string;
      public_key_pem?: string;
    };
  } | null;

  return {
    id: Number(row.id),
    createdAt: row.created_at,
    userWalletAddress: row.user_wallet_address,
    contentId: row.content_id,
    contentHash: row.content_hash,
    action: row.action,
    nullifierHash: row.nullifier_hash,
    verificationLevel: row.verification_level,
    merkleRoot: row.merkle_root,
    imageMimeType: row.image_mime_type,
    imageFileName: row.image_file_name,
    imageSizeBytes: Number(row.image_size_bytes ?? 0),
    imageBase64: Buffer.from(row.image_bytes).toString("base64"),
    provenancePayload: row.provenance_payload,
    worldSignatureMessage: String(payload?.world_signature?.message ?? ""),
    worldSignatureB64: String(payload?.world_signature?.signature_b64 ?? ""),
    worldSignaturePublicKeyPem: String(payload?.world_signature?.public_key_pem ?? ""),
  };
}

export async function findUploadedImageByContentHash(contentHash: string): Promise<UploadedImageProofRecord | null> {
  const normalized = String(contentHash ?? "").trim();
  if (!normalized) return null;

  const db = getPool();
  await ensureSchema(db);
  const res = await db.query<UploadedImageRow>(
    `
      SELECT
        id,
        created_at,
        user_wallet_address,
        content_id,
        content_hash,
        action,
        nullifier_hash,
        verification_level,
        merkle_root,
        image_mime_type,
        image_file_name,
        image_size_bytes,
        image_bytes,
        provenance_payload
      FROM uploaded_images
      WHERE content_hash = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalized],
  );

  if (!res.rows[0]) return null;
  return mapUploadedImageRow(res.rows[0]);
}

export async function findUploadedImageById(id: number): Promise<UploadedImageProofRecord | null> {
  if (!Number.isFinite(id) || id <= 0) return null;

  const db = getPool();
  await ensureSchema(db);
  const res = await db.query<UploadedImageRow>(
    `
      SELECT
        id,
        created_at,
        user_wallet_address,
        content_id,
        content_hash,
        action,
        nullifier_hash,
        verification_level,
        merkle_root,
        image_mime_type,
        image_file_name,
        image_size_bytes,
        image_bytes,
        provenance_payload
      FROM uploaded_images
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  if (!res.rows[0]) return null;
  return mapUploadedImageRow(res.rows[0]);
}
