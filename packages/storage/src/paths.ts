/**
 * Dataset S3 path construction, ported from legacy
 * `data-store-api/helpers/aws_helpers.py` + `sanitize.py`.
 */
import type { StorageService } from "./service.js";

export interface S3Location {
  bucket_name: string;
  path: string;
  s3_uri: string;
}

/** Replaces full stops and slashes with dashes, strips whitespace. */
export const sanitizeHandle = (handle: string): string =>
  handle.replaceAll(".", "-").replaceAll("/", "-").trim();

export const sanitizeName = (name: string): string =>
  name.trim().replaceAll(" ", "_").toUpperCase();

const locationFor = (storage: StorageService, path: string): S3Location => ({
  bucket_name: storage.bucket,
  path,
  s3_uri: `s3://${storage.bucket}/${path}`,
});

/** Construct a new unique dataset path (mint flow). */
export const constructS3Path = async (
  storage: StorageService,
  handle: string,
): Promise<S3Location> => {
  const path = `${storage.datasetPathPrefix}/${sanitizeHandle(handle)}/`;
  if (await storage.pathExists(path)) {
    throw new Error("Handle was not unique as a path name - aborting!");
  }
  return locationFor(storage, path);
};

/** Find the existing dataset path (update flow) - must already exist. */
export const findS3Path = async (
  storage: StorageService,
  handle: string,
): Promise<S3Location> => {
  const path = `${storage.datasetPathPrefix}/${sanitizeHandle(handle)}/`;
  return locationFor(storage, path);
};

export const METADATA_FILE_NAME = "metadata.json";

export const metadataKeyForPath = (path: string): string =>
  `${path.replace(/\/+$/, "")}/${METADATA_FILE_NAME}`;
