/**
 * StorageService - S3-compatible object operations + short-lived scoped
 * credential brokering via STS AssumeRole with inline session policies.
 *
 * Works against any S3+STS compatible store (RustFS is the default backend
 * in the compose stack; MinIO / Ceph RGW / AWS S3 also work).
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig, type ProvenaConfig } from "@provena/config";
import { createPolicyDocument, generateReadWritePaths, type S3LocationLike } from "./policy.js";

export interface BrokeredCredentials {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
  /** ISO timestamp */
  expiry: string;
}

export interface StorageServiceOptions {
  config?: ProvenaConfig;
}

const sanitizeSessionName = (name: string): string =>
  /* STS RoleSessionName: [\w+=,.@-]{2,64} */
  name.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);

export class StorageService {
  private readonly config: ProvenaConfig;
  readonly s3: S3Client;
  private readonly sts: STSClient;
  /** Separate client signing against the public endpoint for presigned URLs. */
  private readonly publicS3: S3Client;

  constructor(options: StorageServiceOptions = {}) {
    this.config = options.config ?? getConfig();
    const common = {
      region: this.config.STORAGE_REGION,
      credentials: {
        accessKeyId: this.config.STORAGE_ACCESS_KEY,
        secretAccessKey: this.config.STORAGE_SECRET_KEY,
      },
      forcePathStyle: this.config.STORAGE_FORCE_PATH_STYLE,
    };
    this.s3 = new S3Client({ ...common, endpoint: this.config.STORAGE_ENDPOINT });
    this.publicS3 = new S3Client({
      ...common,
      endpoint: this.config.STORAGE_PUBLIC_ENDPOINT ?? this.config.STORAGE_ENDPOINT,
    });
    this.sts = new STSClient({ ...common, endpoint: this.config.STORAGE_ENDPOINT });
  }

  get bucket(): string {
    return this.config.STORAGE_BUCKET;
  }

  get datasetPathPrefix(): string {
    return this.config.STORAGE_DATASET_PATH;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /** Folder-or-object existence check (legacy is_s3_path_in_bucket). */
  async pathExists(path: string): Promise<boolean> {
    const prefix = path.replace(/\/+$/, "");
    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: "/",
        MaxKeys: 1,
      }),
    );
    return (response.CommonPrefixes?.length ?? 0) > 0 || (response.Contents?.length ?? 0) > 0;
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async putJsonObject(key: string, body: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(body, null, 2),
        ContentType: "application/json",
      }),
    );
  }

  async putObject(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async presignedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.publicS3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * Broker short-lived credentials scoped to a dataset prefix.
   * Uses STS AssumeRole against the storage endpoint with an inline session
   * policy restricting access to the dataset path (write=false -> read only).
   */
  async brokerDatasetCredentials(input: {
    location: S3LocationLike;
    write: boolean;
    sessionName: string;
  }): Promise<BrokeredCredentials> {
    const paths = generateReadWritePaths(input.location, input.write);
    const policy = createPolicyDocument(paths);
    const response = await this.sts.send(
      new AssumeRoleCommand({
        RoleArn: this.config.STORAGE_STS_ROLE_ARN,
        RoleSessionName: sanitizeSessionName(input.sessionName),
        Policy: policy,
        DurationSeconds: this.config.STORAGE_CREDENTIAL_DURATION_SECONDS,
      }),
    );
    const creds = response.Credentials;
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      throw new Error("STS call succeeded but no credentials were present.");
    }
    return {
      aws_access_key_id: creds.AccessKeyId,
      aws_secret_access_key: creds.SecretAccessKey,
      aws_session_token: creds.SessionToken,
      expiry: (creds.Expiration ?? new Date(Date.now() + 3600 * 1000)).toISOString(),
    };
  }

  /**
   * Console session URL for the storage backend web UI, if configured
   * (replaces the legacy AWS console federation). Returns null when not
   * configured.
   */
  consoleSessionUrl(location: S3LocationLike): string | null {
    const template = this.config.STORAGE_CONSOLE_URL_TEMPLATE;
    if (!template) return null;
    return template
      .replaceAll("{bucket}", encodeURIComponent(location.bucket_name))
      .replaceAll("{path}", encodeURIComponent(location.path));
  }
}

let singleton: StorageService | undefined;

export const getStorageService = (): StorageService => {
  if (!singleton) singleton = new StorageService();
  return singleton;
};

export const resetStorageService = (): void => {
  singleton = undefined;
};
