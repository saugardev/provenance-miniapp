import { Pool } from "pg";

type PersistUploadedImageInput = {
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
    "CREATE INDEX IF NOT EXISTS uploaded_images_nullifier_action_idx ON uploaded_images (nullifier_hash, action)",
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING id
    `,
    [
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
