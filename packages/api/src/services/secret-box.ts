import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for stored credentials (AI keys, MCP tokens, storage
 * keys in admin settings). The database alone can't reveal them.
 *
 * Keys:
 * - `v1` values use a key derived from the auth secret (BETTER_AUTH_SECRET).
 * - `v2` values use a dedicated encryption key (KAVERO_ENCRYPTION_KEY), so the
 *   auth secret can be rotated without losing stored credentials.
 *
 * New values use v2 when an encryption key is set, otherwise v1. Both stay readable.
 */
export class SecretBox {
  private readonly legacyKey: Buffer;
  private readonly key: Buffer | null;

  constructor(appSecret: string, encryptionKey?: string | null) {
    if (!appSecret || appSecret.length < 32) throw new Error("An app secret of at least 32 characters is required");
    this.legacyKey = derive(appSecret, "kavero:secret-box:v1");
    const k = encryptionKey?.trim();
    if (k && k.length < 32) throw new Error("KAVERO_ENCRYPTION_KEY must be at least 32 characters");
    this.key = k ? derive(k, "kavero:secret-box:v2") : null;
  }

  /** Short, non-secret id of the key new values are sealed with (for diagnostics). */
  get keyId(): string {
    return this.key ? `v2:${fingerprint(this.key)}` : `v1:${fingerprint(this.legacyKey)}`;
  }

  seal(plain: string): string {
    const version = this.key ? "v2" : "v1";
    const key = this.key ?? this.legacyKey;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(".");
    const key = v === "v1" ? this.legacyKey : v === "v2" ? this.key : null;
    if (!key || !iv || !tag || !data) throw new Error("Unreadable secret");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }

  /** True when a value was sealed with an older key and should be re-sealed. */
  needsReseal(sealed: string): boolean {
    return !!this.key && sealed.startsWith("v1.");
  }
}

function derive(secret: string, info: string) {
  return Buffer.from(hkdfSync("sha256", secret, "kavero", info, 32));
}

function fingerprint(key: Buffer) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}
