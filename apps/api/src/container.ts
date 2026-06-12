/**
 * Lazily-constructed service container - repositories + storage shared by
 * routers and job handlers.
 */
import {
  getDb,
  makeAccessRequestRepo,
  makeAuthRepo,
  makeEdgeRepo,
  makeGroupRepo,
  makeHandleRepo,
  makeItemRepo,
  makeJobRepo,
  makeLinkRepo,
  makeLockRepo,
  makeReviewerRepo,
  type Database,
} from "@provena/db";
import { getStorageService, type StorageService } from "@provena/storage";

export interface Container {
  db: Database;
  items: ReturnType<typeof makeItemRepo>;
  auth: ReturnType<typeof makeAuthRepo>;
  locks: ReturnType<typeof makeLockRepo>;
  edges: ReturnType<typeof makeEdgeRepo>;
  groups: ReturnType<typeof makeGroupRepo>;
  accessRequests: ReturnType<typeof makeAccessRequestRepo>;
  links: ReturnType<typeof makeLinkRepo>;
  handles: ReturnType<typeof makeHandleRepo>;
  jobs: ReturnType<typeof makeJobRepo>;
  reviewers: ReturnType<typeof makeReviewerRepo>;
  storage: StorageService;
}

let container: Container | undefined;

export const getContainer = (): Container => {
  if (!container) {
    const db = getDb();
    container = {
      db,
      items: makeItemRepo(db),
      auth: makeAuthRepo(db),
      locks: makeLockRepo(db),
      edges: makeEdgeRepo(db),
      groups: makeGroupRepo(db),
      accessRequests: makeAccessRequestRepo(db),
      links: makeLinkRepo(db),
      handles: makeHandleRepo(db),
      jobs: makeJobRepo(db),
      reviewers: makeReviewerRepo(db),
      storage: getStorageService(),
    };
  }
  return container;
};

export const resetContainer = (): void => {
  container = undefined;
};
