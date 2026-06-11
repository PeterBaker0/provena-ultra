/**
 * Storage integration test - requires an S3+STS compatible store (RustFS in
 * CI/dev compose) reachable at STORAGE_ENDPOINT with root credentials.
 *
 * Validates the core Provena storage workflow:
 *  - bucket bootstrap + metadata writes
 *  - STS AssumeRole with inline session policy produces credentials that are
 *    properly scoped to the dataset prefix (read and write variants)
 *  - presigned URLs work
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "@provena/config";
import { StorageService } from "./service.js";
import { constructS3Path, metadataKeyForPath } from "./paths.js";

const storage = new StorageService();
const uniq = Date.now().toString();
const handleA = `10378.1/${uniq}1`;
const handleB = `10378.1/${uniq}2`;

const clientFor = (creds: {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token: string;
}) =>
  new S3Client({
    region: getConfig().STORAGE_REGION,
    endpoint: getConfig().STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: creds.aws_access_key_id,
      secretAccessKey: creds.aws_secret_access_key,
      sessionToken: creds.aws_session_token,
    },
  });

beforeAll(async () => {
  await storage.ensureBucket();
});

describe("storage service", () => {
  it("constructs unique dataset paths and writes metadata", async () => {
    const location = await constructS3Path(storage, handleA);
    expect(location.path).toBe(`datasets/10378-1-${uniq}1/`);
    await storage.putJsonObject(metadataKeyForPath(location.path), { handle: handleA });
    expect(await storage.objectExists(metadataKeyForPath(location.path))).toBe(true);
    /* now the path exists - constructing again must fail */
    await expect(constructS3Path(storage, handleA)).rejects.toThrow(/not unique/);
  });

  it("brokers READ credentials scoped to the dataset prefix", async () => {
    const location = { bucket_name: storage.bucket, path: `datasets/10378-1-${uniq}1/` };
    /* seed an object in another dataset to test scope enforcement */
    const otherKey = `datasets/10378-1-${uniq}2/secret.json`;
    await storage.putJsonObject(otherKey, { secret: true });

    const creds = await storage.brokerDatasetCredentials({
      location,
      write: false,
      sessionName: "alice,read-prog-bucket-access",
    });
    expect(creds.aws_access_key_id).toBeTruthy();
    expect(new Date(creds.expiry).getTime()).toBeGreaterThan(Date.now());

    const scoped = clientFor(creds);

    /* allowed: read within own prefix */
    const ok = await scoped.send(
      new GetObjectCommand({
        Bucket: storage.bucket,
        Key: metadataKeyForPath(location.path),
      }),
    );
    expect(ok.$metadata.httpStatusCode).toBe(200);

    /* denied: read outside prefix */
    await expect(
      scoped.send(new GetObjectCommand({ Bucket: storage.bucket, Key: otherKey })),
    ).rejects.toMatchObject({ name: expect.stringMatching(/AccessDenied/i) });

    /* denied: write anywhere (read-only creds) */
    await expect(
      scoped.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: `${location.path}new-file.txt`,
          Body: "nope",
        }),
      ),
    ).rejects.toMatchObject({ name: expect.stringMatching(/AccessDenied/i) });
  });

  it("brokers WRITE credentials allowing uploads within the prefix only", async () => {
    const location = { bucket_name: storage.bucket, path: `datasets/10378-1-${uniq}1/` };
    const creds = await storage.brokerDatasetCredentials({
      location,
      write: true,
      sessionName: "alice,write-prog-bucket-access",
    });
    const scoped = clientFor(creds);

    const put = await scoped.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: `${location.path}data/file.txt`,
        Body: "hello",
      }),
    );
    expect(put.$metadata.httpStatusCode).toBe(200);

    /* denied: write outside prefix */
    await expect(
      scoped.send(
        new PutObjectCommand({
          Bucket: storage.bucket,
          Key: `datasets/10378-1-${uniq}2/intruder.txt`,
          Body: "nope",
        }),
      ),
    ).rejects.toMatchObject({ name: expect.stringMatching(/AccessDenied/i) });
  });

  it("creates working presigned GET urls", async () => {
    const key = metadataKeyForPath(`datasets/10378-1-${uniq}1/`);
    const url = await storage.presignedGetUrl(key, 300);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { handle: string };
    expect(body.handle).toBe(handleA);
  });

  it("returns null console url when not configured", () => {
    expect(
      storage.consoleSessionUrl({ bucket_name: storage.bucket, path: "datasets/x/" }),
    ).toBeNull();
  });
});
