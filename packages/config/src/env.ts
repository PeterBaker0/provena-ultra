import path from "node:path";
import { existsSync } from "node:fs";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

let dotEnvLoaded = false;

const findEnvFile = (startDir: string): string | undefined => {
  let currentDir = startDir;

  while (true) {
    const envPath = path.join(currentDir, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
};

const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z.string().default("http://localhost:3002,http://localhost:3003"),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_AUTH_ENDPOINT: z.string().url(),
  PG_BOSS_SCHEMA: z.string().default("pgboss"),
  PG_BOSS_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  STORAGE_PROVIDER: z.enum(["ceph-rgw", "minio", "generic"]).default("ceph-rgw"),
  HANDLE_SERVICE_PREFIX: z.string().default("provena"),
  HANDLE_SERVICE_BASE_URL: z.string().url(),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().email(),
  VITE_AUTH_API_ENDPOINT: z.string().url(),
  VITE_DATA_STORE_API_ENDPOINT: z.string().url(),
  VITE_REGISTRY_API_ENDPOINT: z.string().url(),
  VITE_PROV_API_ENDPOINT: z.string().url(),
  VITE_SEARCH_API_ENDPOINT: z.string().url(),
  VITE_JOB_API_ENDPOINT: z.string().url(),
  VITE_KEYCLOAK_AUTH_ENDPOINT: z.string().url(),
  VITE_LANDING_PAGE_LINK: z.string().url(),
  VITE_DATA_STORE_LINK: z.string().url(),
  VITE_PROV_STORE_LINK: z.string().url(),
  VITE_REGISTRY_LINK: z.string().url(),
  VITE_DOCUMENTATION_BASE_LINK: z.string().url(),
  VITE_CONTACT_US_LINK: z.string().url(),
});

export type Env = z.infer<typeof envSchema> & {
  CORS_ORIGIN_LIST: string[];
};

let cachedEnv: Env | undefined;

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }

  if (!dotEnvLoaded) {
    const envPath = findEnvFile(process.cwd());
    if (envPath) {
      loadDotEnv({ path: envPath });
    }
    dotEnvLoaded = true;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  cachedEnv = {
    ...parsed.data,
    CORS_ORIGIN_LIST: splitCsv(parsed.data.CORS_ORIGINS),
  };

  return cachedEnv;
};

export const resetEnvCache = (): void => {
  cachedEnv = undefined;
};
