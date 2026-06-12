/**
 * IAM session policy generation for short-lived scoped dataset credentials.
 * Ported from legacy `data-store-api/helpers/aws_helpers.py` /
 * `sts_helpers.py` - identical action lists and resource scoping (bucket-wide
 * list access is intentional so `aws s3 sync` works).
 */

export interface S3CredentialPaths {
  readUris: string[];
  writeUris: string[];
  listUris: string[];
}

export interface S3LocationLike {
  bucket_name: string;
  path: string;
}

export const generateReadWritePaths = (
  location: S3LocationLike,
  write: boolean,
): S3CredentialPaths => {
  const baseDatasetPath = `arn:aws:s3:::${location.bucket_name}/${location.path}`.replace(
    /\/+$/,
    "",
  );
  const scoped = [baseDatasetPath, `${baseDatasetPath}/`, `${baseDatasetPath}/*`];
  const bucketPath = `arn:aws:s3:::${location.bucket_name}`;
  return {
    readUris: scoped,
    writeUris: write ? scoped : [],
    listUris: [bucketPath, `${bucketPath}/*`],
  };
};

interface PolicyStatement {
  Action: string[];
  Resource: string[];
  Effect: "Allow";
}

/*
 * NOTE: the legacy policy used AWS action wildcards (`s3:GetObject*`,
 * `s3:DeleteObject*`, `s3:Abort*`). RustFS's policy parser only accepts
 * explicit action names (or `s3:*`), so the wildcards are expanded into
 * their explicit equivalents - all of which are also valid AWS/MinIO/Ceph
 * action names, keeping the policy portable across backends.
 */
const READ_OBJECT_ACTIONS = [
  "s3:GetObject",
  "s3:GetObjectVersion",
  "s3:GetObjectTagging",
  "s3:GetObjectVersionTagging",
  "s3:GetObjectAttributes",
  "s3:GetObjectVersionAttributes",
  "s3:GetObjectLegalHold",
  "s3:GetObjectRetention",
];

const WRITE_OBJECT_ACTIONS = [
  ...READ_OBJECT_ACTIONS,
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "s3:DeleteObjectTagging",
  "s3:DeleteObjectVersionTagging",
  "s3:PutObject",
  "s3:PutObjectLegalHold",
  "s3:PutObjectRetention",
  "s3:PutObjectTagging",
  "s3:PutObjectVersionTagging",
  "s3:AbortMultipartUpload",
  "s3:ListMultipartUploadParts",
];

const LIST_ACTIONS = [
  "s3:ListBucket",
  "s3:ListBucketMultipartUploads",
  "s3:ListBucketVersions",
];

export const createPolicyDocument = (paths: S3CredentialPaths): string => {
  const statements: PolicyStatement[] = [];
  if (paths.writeUris.length > 0) {
    statements.push({
      Action: WRITE_OBJECT_ACTIONS,
      Resource: paths.writeUris,
      Effect: "Allow",
    });
  }
  if (paths.readUris.length > 0) {
    statements.push({
      Action: READ_OBJECT_ACTIONS,
      Resource: paths.readUris,
      Effect: "Allow",
    });
  }
  if (paths.listUris.length > 0) {
    statements.push({
      Action: LIST_ACTIONS,
      Resource: paths.listUris,
      Effect: "Allow",
    });
  }
  return JSON.stringify({ Version: "2012-10-17", Statement: statements });
};
