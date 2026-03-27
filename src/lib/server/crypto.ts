import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "$env/dynamic/private";

/** Derives a 32-byte AES key from BETTER_AUTH_SECRET via SHA-256 */
function getKey(): Buffer {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET environment variable is required");
  return createHash("sha256").update(env.BETTER_AUTH_SECRET).digest();
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
 * Encrypts a proxy token containing a target URL, the requesting userId,
 * and the allowedHost to prevent SSRF by ensuring all proxied requests
 * stay on the same upstream server.
 */
export function encryptProxyToken(targetUrl: string, userId: string, allowedHost: string): string {
  return encrypt(JSON.stringify({ url: targetUrl, userId, allowedHost }));
}

/**
 * Decrypts a token produced by `encryptProxyToken()`.
 * Throws if tampered or malformed.
 */
export function decryptProxyToken(token: string): { url: string; userId: string; allowedHost: string } {
  const payload = JSON.parse(decrypt(token)) as { url?: string; userId?: string; allowedHost?: string };
  if (!payload.url || !payload.userId || !payload.allowedHost) throw new Error("Invalid token payload");
  return payload as { url: string; userId: string; allowedHost: string };
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
