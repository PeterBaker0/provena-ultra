import { getEnv } from "@provena/config";
import { getDb, AuthRepository, RegistryRepository, type DbClient } from "@provena/db";
import type { Logger } from "@provena/observability";
import { createQueueService, type QueueService } from "@provena/queue";
import { createStorageAdapter, type StorageAdapter } from "@provena/storage";
import { createAuthService, type AuthService } from "./authService";
import { createRegistryService, type RegistryService } from "./registryService";
import { createJobsService, type JobsService } from "./jobsService";
import { createDataStoreService, type DataStoreService } from "./dataStoreService";
import { createProvService, type ProvService } from "./provService";
import { createSearchService, type SearchService } from "./searchService";
import { createHandleService, type HandleService } from "./handleService";

export interface Services {
  auth: AuthService;
  registry: RegistryService;
  jobs: JobsService;
  dataStore: DataStoreService;
  prov: ProvService;
  search: SearchService;
  handle: HandleService;
}

export interface RuntimeServices {
  db: DbClient;
  queue: QueueService;
  storage: StorageAdapter;
  services: Services;
}

export const buildServices = (logger: Logger): RuntimeServices => {
  const env = getEnv();
  const db = getDb();
  const queue = createQueueService(env, logger);
  const storage = createStorageAdapter({
    provider: env.STORAGE_PROVIDER,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });

  const authRepository = new AuthRepository(db);
  const registryRepository = new RegistryRepository(db);

  const jobs = createJobsService(db, queue);

  const services: Services = {
    auth: createAuthService(authRepository),
    registry: createRegistryService(db, registryRepository),
    jobs,
    dataStore: createDataStoreService(db, registryRepository, storage),
    prov: createProvService(db, jobs),
    search: createSearchService(db),
    handle: createHandleService(db),
  };

  return {
    db,
    queue,
    storage,
    services,
  };
};
