/**
 * Centralised, zod-validated environment configuration for the Provena
 * backend (API + worker). UI configuration is handled separately via Vite
 * env vars.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const boolString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["true", "1", "yes"].includes(v.toLowerCase())));

const configSchema = z.object({
  /* General */
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(8080),
  /** Public base URL of the API (used in emails / report links). */
  API_PUBLIC_URL: z.string().default("http://localhost:8080"),
  CORS_ORIGINS: z.string().default("*"),
  /**
   * Browser hostname(s) allowed for CORS (any port). Merged with `PUBLIC_HOST`.
   * Use for remote VM access, e.g. `adria.it.csiro.au,localhost`.
   */
  CORS_ALLOWED_HOSTS: z.string().optional(),
  /** Public browser hostname (see root `.env` / `pnpm env:public-urls`). */
  PUBLIC_HOST: z.string().optional(),

  /* Database */
  DATABASE_URL: z
    .string()
    .default("postgres://provena:provena@localhost:8432/provena"),

  /* Keycloak */
  /** Full realm issuer URL, e.g. https://auth.example.com/realms/provena */
  KEYCLOAK_ISSUER: z.string().default("http://localhost:8081/realms/provena"),
  /** Optional override for the JWKS endpoint (defaults to issuer well-known). */
  KEYCLOAK_JWKS_URL: z.string().optional(),
  /**
   * Test-mode signing key (HS256 shared secret). When set, tokens signed with
   * this secret are accepted INSTEAD of Keycloak JWKS - never set in
   * production.
   */
  AUTH_TEST_SHARED_SECRET: z.string().optional(),

  /* Object storage (S3-compatible + STS) */
  STORAGE_ENDPOINT: z.string().default("http://localhost:9000"),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_ACCESS_KEY: z.string().default("provena-root"),
  STORAGE_SECRET_KEY: z.string().default("provena-secret"),
  STORAGE_BUCKET: z.string().default("provena-datasets"),
  /** Key prefix under which dataset folders are created. */
  STORAGE_DATASET_PATH: z.string().default("datasets"),
  /** Role ARN passed to STS AssumeRole (stores may ignore the actual value). */
  STORAGE_STS_ROLE_ARN: z.string().default("arn:aws:iam::000000000000:role/provena-dataset-access"),
  STORAGE_CREDENTIAL_DURATION_SECONDS: z.coerce.number().int().default(3600),
  /** Optional public endpoint override used in presigned URLs. */
  STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
  /**
   * Optional console URL template for the storage backend web UI. Supports
   * {bucket} and {path} placeholders. When unset, console_session_url is null.
   */
  STORAGE_CONSOLE_URL_TEMPLATE: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: boolString.default(true),

  /* Handle minting */
  HANDLE_PREFIX: z.string().default("10378.1"),

  /* Email */
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(8125),
  SMTP_SECURE: boolString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("provena@localhost"),
  /** Destination for access-request notification emails. */
  ACCESS_REQUEST_EMAIL_ADDRESS: z.string().default("admin@localhost"),

  /* Jobs */
  WORKER_EMBEDDED: boolString.default(true),

  /* Misc */
  GIT_COMMIT_ID: z.string().optional(),
  VERSION_TAG: z.string().default("2.0.0"),
});

export type ProvenaConfig = z.infer<typeof configSchema>;

/** Walk up from cwd to find the repo root .env (best effort). */
const findEnvFile = (): string | undefined => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};

let cached: ProvenaConfig | undefined;

export const getConfig = (): ProvenaConfig => {
  if (cached) return cached;
  const envFile = findEnvFile();
  if (envFile) loadDotenv({ path: envFile });
  cached = configSchema.parse(process.env);
  return cached;
};

/** Test helper - override config values (returns restore function). */
export const overrideConfigForTesting = (values: Partial<ProvenaConfig>): (() => void) => {
  const previous = cached;
  cached = { ...getConfig(), ...values };
  return () => {
    cached = previous;
  };
};
