/**
 * System-level (Keycloak realm role) authorisation model.
 *
 * Ported from legacy `ProvenaInterfaces/AuthAPI.py`. Role names must match the
 * roles configured in the reused Keycloak realm exactly.
 */
import type {
  AccessLevel,
  AuthorisationComponent,
  ComponentName,
  ComponentRole,
} from "../types/AuthAPI.js";

const adminOnly = ["ADMINISTRATOR"] as const;
const generalAndAdmin = ["GENERAL", "ADMINISTRATOR"] as const;

export const JOB_SERVICE_COMPONENT: AuthorisationComponent = {
  component_name: "job-service",
  component_roles: [
    {
      role_name: "job-service-admin",
      role_display_name: "Job Service Admin",
      role_level: "ADMIN",
      description: "Admin role which enables management of jobs including lodging.",
      intended_users: [...adminOnly],
    },
    {
      role_name: "job-service-write",
      role_display_name: "Job Service Write",
      role_level: "WRITE",
      description: "Allows r/w and lodging of jobs",
      intended_users: [...adminOnly],
    },
    {
      role_name: "job-service-read",
      role_display_name: "Job Service Read",
      role_level: "READ",
      description: "Allows reading of all user's jobs",
      intended_users: [...adminOnly],
    },
  ],
};

export const HANDLE_SERVICE_COMPONENT: AuthorisationComponent = {
  component_name: "handle-service",
  component_roles: [
    {
      role_name: "handle-read",
      role_display_name: "Handle service read only access",
      role_level: "READ",
      description:
        "Allows access to read only functions of the handle service. This enables viewing, retrieving, listing of handles.",
      intended_users: [...adminOnly],
    },
    {
      role_name: "handle-write",
      role_display_name: "Handle service write access",
      role_level: "WRITE",
      description:
        "Allows access to read and write functions of the handle service. This enables registering, viewing, retrieving, listing of handles.",
      intended_users: [...adminOnly],
    },
    {
      role_name: "handle-admin",
      role_display_name: "Handle service full admin access",
      role_level: "ADMIN",
      description: "Allows full access to the handle service.",
      intended_users: [...adminOnly],
    },
  ],
};

export const SYS_ADMIN_COMPONENT: AuthorisationComponent = {
  component_name: "sys-admin",
  component_roles: [
    {
      role_name: "sys-admin-read",
      role_display_name: "Sys admin read only access",
      role_level: "READ",
      description:
        "Allows read only access to system admin functions. This includes listing and viewing access requests.",
      intended_users: [...adminOnly],
    },
    {
      role_name: "sys-admin-write",
      role_display_name: "Sys admin write/read access",
      role_level: "WRITE",
      description:
        "Allows read and write access to system admin functions. This includes listing, viewing, modifying and adding notes to access requests.",
      intended_users: [...adminOnly],
    },
    {
      role_name: "sys-admin-admin",
      role_display_name: "Sys admin full access",
      role_level: "ADMIN",
      description:
        "Allows complete access to system admin functions. This includes listing, viewing, modifying, deleting and adding notes to access requests.",
      intended_users: [...adminOnly],
    },
  ],
};

export const ENTITY_REGISTRY_COMPONENT: AuthorisationComponent = {
  component_name: "entity-registry",
  component_roles: [
    {
      role_name: "entity-registry-read",
      role_display_name: "Entity registry read only access",
      role_level: "READ",
      description: "Allows read only access to the entity registry - list, view.",
      intended_users: [...generalAndAdmin],
    },
    {
      role_name: "entity-registry-write",
      role_display_name: "Entity registry write/read access",
      role_level: "WRITE",
      description: "Allows creation and modification of resources in the entity registry.",
      intended_users: [...generalAndAdmin],
    },
    {
      role_name: "entity-registry-admin",
      role_display_name: "Entity registry full access",
      role_level: "ADMIN",
      description: "Allows all actions against all entity registry resources.",
      intended_users: [...adminOnly],
    },
  ],
};

export const AUTHORISATION_COMPONENTS: AuthorisationComponent[] = [
  HANDLE_SERVICE_COMPONENT,
  SYS_ADMIN_COMPONENT,
  ENTITY_REGISTRY_COMPONENT,
  JOB_SERVICE_COMPONENT,
];

/** Find the role of a component which grants the requested level. */
export const getRoleAtLevel = (
  component: AuthorisationComponent,
  level: AccessLevel,
): ComponentRole => {
  const role = component.component_roles.find((r) => r.role_level === level);
  if (!role) {
    throw new Error(
      `Failed to find a role at level ${level} for component ${component.component_name}.`,
    );
  }
  return role;
};

export const getComponent = (name: ComponentName): AuthorisationComponent => {
  const component = AUTHORISATION_COMPONENTS.find((c) => c.component_name === name);
  if (!component) throw new Error(`Unknown authorisation component ${name}.`);
  return component;
};
