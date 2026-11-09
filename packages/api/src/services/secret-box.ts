import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for stored third-party credentials (e.g. MCP server
 * tokens). The key is derived from the app secret, so the database alone can't
 * reveal them.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(appSecret: string) {
    if (!appSecret || appSecret.length < 32) throw new Error("An app secret of at least 32 characters is required");
    this.key = Buffer.from(hkdfSync("sha256", appSecret, "kavero", "kavero:secret-box:v1", 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}
