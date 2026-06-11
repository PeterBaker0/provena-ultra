/**
 * Per-component access level guards, mirroring legacy service dependencies:
 *   read    -> ALL of [read]
 *   write   -> ALL of [read, write]
 *   admin   -> ALL of [read, write, admin]
 */
import {
  ENTITY_REGISTRY_COMPONENT,
  HANDLE_SERVICE_COMPONENT,
  JOB_SERVICE_COMPONENT,
  SYS_ADMIN_COMPONENT,
  getRoleAtLevel,
} from "@provena/interfaces";
import type { AuthorisationComponent } from "@provena/interfaces/types/AuthAPI";
import type { MiddlewareHandler } from "hono";
import { requireAllRoles } from "./middleware.js";
import type { AuthEnv, AuthenticatedUser } from "./types.js";

export interface ComponentGuards {
  readRole: string;
  writeRole: string;
  adminRole: string;
  read: MiddlewareHandler<AuthEnv>;
  write: MiddlewareHandler<AuthEnv>;
  admin: MiddlewareHandler<AuthEnv>;
  isAdmin: (user: AuthenticatedUser) => boolean;
}

const buildGuards = (component: AuthorisationComponent): ComponentGuards => {
  const readRole = getRoleAtLevel(component, "READ").role_name;
  const writeRole = getRoleAtLevel(component, "WRITE").role_name;
  const adminRole = getRoleAtLevel(component, "ADMIN").role_name;
  return {
    readRole,
    writeRole,
    adminRole,
    read: requireAllRoles([readRole]),
    write: requireAllRoles([readRole, writeRole]),
    admin: requireAllRoles([readRole, writeRole, adminRole]),
    isAdmin: (user) => user.roles.includes(adminRole),
  };
};

export const entityRegistryGuards = buildGuards(ENTITY_REGISTRY_COMPONENT);
export const sysAdminGuards = buildGuards(SYS_ADMIN_COMPONENT);
export const handleGuards = buildGuards(HANDLE_SERVICE_COMPONENT);
export const jobGuards = buildGuards(JOB_SERVICE_COMPONENT);
