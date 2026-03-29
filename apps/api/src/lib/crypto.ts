import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function getKey(): Buffer {
  const raw = process.env.TOKENS_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKENS_ENCRYPTION_KEY is required in production");
    }
    return crypto.scryptSync("dev-insecure-key-change-me", "salt", KEY_LEN);
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b = Buffer.from(raw, "base64");
    if (b.length === KEY_LEN) return b;
  } catch {
    /* fallthrough */
  }
  return crypto.scryptSync(raw, "mlaffon-tokens", KEY_LEN);
}

/**
 * Формат: base64(iv|ciphertext|tag)
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64url");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64url");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(IV_LEN, buf.length - 16);
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, "utf8") + decipher.final("utf8");
}
