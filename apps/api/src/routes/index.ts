import type { Hono } from "hono";
import type { ApiBindings } from "../types";
import { createCheckAccessRoutes } from "./checkAccess";
import { createGroupsRouter } from "./groups";
import { createAccessControlRoutes } from "./accessControl";
import { createLinkRoutes } from "./link";
import { createRegistryRoutes } from "./registry";
import { createDataStoreRouter } from "./dataStore";
import { createSearchRoutes } from "./search";
import { createProvRoutes } from "./prov";
import { createJobsRoutes } from "./jobs";
import { createIdServiceRoutes } from "./idService";

export const registerAllRoutes = (app: Hono<ApiBindings>): void => {
  app.route("/check-access", createCheckAccessRoutes());
  app.route("/groups", createGroupsRouter());
  app.route("/access-control", createAccessControlRoutes());
  app.route("/link", createLinkRoutes());
  app.route("/registry", createRegistryRoutes());
  app.route("/", createDataStoreRouter());
  app.route("/", createSearchRoutes());
  app.route("/", createProvRoutes());
  app.route("/", createJobsRoutes());
  app.route("/handle", createIdServiceRoutes());
};
