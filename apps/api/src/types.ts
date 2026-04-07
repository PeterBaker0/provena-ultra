import type { AppBindings as AuthBindings } from "@provena/auth";
import type { DbClient } from "@provena/db";
import type { Logger } from "@provena/observability";
import type { QueueService } from "@provena/queue";
import type { StorageAdapter } from "@provena/storage";
import type { Services } from "./services";

export type ApiBindings = AuthBindings & {
  Variables: AuthBindings["Variables"] & {
    requestId: string;
    logger: Logger;
    db: DbClient;
    queue: QueueService;
    storage: StorageAdapter;
    services: Services;
  };
};
