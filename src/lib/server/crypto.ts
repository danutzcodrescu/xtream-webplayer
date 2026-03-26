import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** Derives a 32-byte AES key from BETTER_AUTH_SECRET via SHA-256 */
function getKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? "fallback-dev-secret-change-in-production";
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns `<iv_hex>:<authTag_hex>:<ciphertext_hex>` — safe to store as TEXT.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Encrypts a proxy token containing a target URL and the requesting userId.
 * Used in HLS manifest rewriting so upstream URLs (which contain Xtream credentials)
 * are never exposed to the browser.
 */
export function encryptProxyToken(targetUrl: string, userId: string): string {
  return encrypt(JSON.stringify({ url: targetUrl, userId }));
}

/**
 * Decrypts a token produced by `encryptProxyToken()`.
 * Throws if tampered or malformed.
 */
export function decryptProxyToken(token: string): { url: string; userId: string } {
  const payload = JSON.parse(decrypt(token)) as { url: string; userId: string };
  if (!payload.url || !payload.userId) throw new Error("Invalid token payload");
  return payload;
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Throws if the data is tampered (GCM auth tag mismatch).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");

  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
