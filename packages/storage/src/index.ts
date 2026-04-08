import { randomUUID } from "node:crypto";
import {
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

export type StorageProvider = "ceph-rgw" | "minio" | "generic";

export interface StorageConfig {
  provider: StorageProvider;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
  consoleUrl: string | null;
}

export interface GeneratePresignedUrlInput {
  key: string;
  action: "download" | "upload";
  expiresInSeconds: number;
}

export interface StorageAdapter {
  provider: StorageProvider;
  generateTemporaryCredentials: (username: string, datasetId: string) => Promise<TemporaryCredentials>;
  generatePresignedUrl: (input: GeneratePresignedUrlInput) => Promise<string>;
}

const createS3Client = (config: StorageConfig): S3Client => {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };

  return new S3Client(clientConfig);
};

export const createStorageAdapter = (config: StorageConfig): StorageAdapter => {
  const s3 = createS3Client(config);

  return {
    provider: config.provider,
    generateTemporaryCredentials: async (_username: string, _datasetId: string) => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      return {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: randomUUID(),
        expiresAt,
        consoleUrl: config.provider === "ceph-rgw" ? `${config.endpoint}/` : null,
      };
    },
    generatePresignedUrl: async (input: GeneratePresignedUrlInput) => {
      const command =
        input.action === "download"
          ? new GetObjectCommand({ Bucket: config.bucket, Key: input.key })
          : new PutObjectCommand({ Bucket: config.bucket, Key: input.key });

      return getSignedUrl(s3, command, {
        expiresIn: input.expiresInSeconds,
      });
    },
  };
};
