import { Indexer, ZgFile } from "@0gfoundation/0g-ts-sdk";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonRpcProvider, Wallet } from "ethers";
import type { WorldcoinFirstEntryPayload } from "./worldcoin-first-entry.ts";

const DEFAULT_OG_EVM_RPC = "https://evmrpc-testnet.0g.ai";
const DEFAULT_OG_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";

export type OgStorageReceipt = {
  enabled: boolean;
  published: boolean;
  reason?: string;
  payload_sha256: string;
  payload_bytes: number;
  key: string;
  root_hashes: string[];
  tx_hashes: string[];
  evm_rpc?: string;
  indexer_rpc?: string;
  uploaded_at_ms?: number;
};

function normalizePrivateKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function publishPayloadTo0g(input: {
  payload: WorldcoinFirstEntryPayload;
  nullifierHash: string;
  action: string;
  contentId: string;
}): Promise<OgStorageReceipt> {
  const privateKey = normalizePrivateKey(String(process.env.OG_STORAGE_PRIVATE_KEY ?? ""));
  if (!privateKey) {
    return {
      enabled: false,
      published: false,
      reason: "OG_STORAGE_PRIVATE_KEY is not set; skipping 0G upload.",
      payload_sha256: "",
      payload_bytes: 0,
      key: "",
      root_hashes: [],
      tx_hashes: [],
    };
  }

  const evmRpc = String(process.env.OG_STORAGE_EVM_RPC ?? DEFAULT_OG_EVM_RPC).trim();
  const indexerRpc = String(process.env.OG_STORAGE_INDEXER_RPC ?? DEFAULT_OG_INDEXER_RPC).trim();

  const storageKey = `worldcoin-proof/${input.action}/${input.nullifierHash}/${input.contentId}.json`;
  const record = {
    schema: "livy-worldcoin-proof-0g-v1",
    key: storageKey,
    created_at_ms: Date.now(),
    nullifier_hash: input.nullifierHash,
    action: input.action,
    content_id: input.contentId,
    payload: input.payload,
  };
  const jsonBytes = Buffer.from(JSON.stringify(record), "utf8");
  const payloadSha256 = createHash("sha256").update(jsonBytes).digest("hex");

  const tmpDir = resolve(process.cwd(), "state", "og-tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = resolve(tmpDir, `proof-${randomUUID()}.json`);
  writeFileSync(tmpPath, jsonBytes);

  let file: ZgFile | null = null;
  try {
    const provider = new JsonRpcProvider(evmRpc);
    const signer = new Wallet(privateKey, provider);
    const indexer = new Indexer(indexerRpc);
    file = await ZgFile.fromFilePath(tmpPath);

    const [tx, err] = await indexer.upload(file, evmRpc, signer);
    if (err) {
      throw err;
    }
    if (!tx) {
      throw new Error("0G upload returned no transaction metadata.");
    }

    const txHash = "txHash" in tx ? tx.txHash : undefined;
    const rootHash = "rootHash" in tx ? tx.rootHash : undefined;
    const txHashes = "txHashes" in tx ? tx.txHashes : undefined;
    const rootHashes = "rootHashes" in tx ? tx.rootHashes : undefined;

    return {
      enabled: true,
      published: true,
      payload_sha256: payloadSha256,
      payload_bytes: jsonBytes.byteLength,
      key: storageKey,
      root_hashes: toArray(rootHash).concat(toArray(rootHashes)),
      tx_hashes: toArray(txHash).concat(toArray(txHashes)),
      evm_rpc: evmRpc,
      indexer_rpc: indexerRpc,
      uploaded_at_ms: Date.now(),
    };
  } finally {
    if (file) {
      await file.close().catch(() => undefined);
    }
    unlinkSync(tmpPath);
  }
}
