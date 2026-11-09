import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";

import type { ObjectStorage } from "./object-storage";

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  /** Custom endpoint for S3-compatible services (Cloudflare R2, MinIO). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style addressing (`<endpoint>/<bucket>/<key>`), needed by MinIO. */
  forcePathStyle?: boolean;
}

const KEY = /^[a-zA-Z0-9/_.-]+$/;

/** S3-compatible object storage: AWS S3, Cloudflare R2, MinIO. */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region || (config.endpoint ? "auto" : "us-east-1"),
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? false,
      // Without explicit keys the SDK's default chain applies (IAM role, AWS_* env, shared config).
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    });
  }

  private key(key: string) {
    if (!KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
    return key;
  }

  async put(key: string, data: Uint8Array) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data }));
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      if (!res.Body) return null;
      return await res.Body.transformToByteArray();
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async delete(key: string) {
    // S3 DeleteObject is idempotent: deleting a missing key succeeds.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
}

function isNotFound(e: unknown) {
  if (e instanceof S3ServiceException) {
    return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
  }
  return (e as { name?: string } | null)?.name === "NoSuchKey";
}
