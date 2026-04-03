import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type KeyMaterial = {
  privateKeyPem: string;
  publicKeyPem: string;
};

export function loadOrCreateKeyMaterial(privateKeyPath: string, publicKeyPath: string): KeyMaterial {
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  mkdirSync(dirname(publicKeyPath), { recursive: true });

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    return {
      privateKeyPem: readFileSync(privateKeyPath, "utf8"),
      publicKeyPem: readFileSync(publicKeyPath, "utf8"),
    };
  }

  const pair = generateKeyPairSync("ed25519");
  const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();

  writeFileSync(privateKeyPath, privateKeyPem, "utf8");
  writeFileSync(publicKeyPath, publicKeyPem, "utf8");

  return { privateKeyPem, publicKeyPem };
}
