/**
 * Per-item access evaluation, ported from legacy
 * `registry-api/helpers/auth_helpers.py` / `action_helpers.py`:
 *
 *  - registry admins and item owners get all available roles
 *  - otherwise: general roles union roles granted via shared group membership,
 *    limited to the roles available for the subtype.
 */
import type { Roles } from "@provena/interfaces";

export interface AccessSettingsLike {
  owner: string;
  general: string[];
  groups: Record<string, string[]>;
}

/** True iff ANY acceptable role is held. */
export const evaluateUserAccess = (userRoles: Roles, acceptableRoles: Roles): boolean =>
  acceptableRoles.some((role) => userRoles.includes(role));

/** Union of general roles + group-granted roles for the user's groups. */
export const determineUserAccess = (
  settings: AccessSettingsLike,
  userGroupIds: ReadonlySet<string>,
): Roles => {
  const roles = new Set<string>(settings.general);
  for (const [groupId, groupRoles] of Object.entries(settings.groups)) {
    if (userGroupIds.has(groupId)) {
      for (const role of groupRoles) roles.add(role);
    }
  }
  return [...roles];
};

export interface DescribeAccessInput {
  username: string;
  isRegistryAdmin: boolean;
  settings: AccessSettingsLike;
  userGroupIds: ReadonlySet<string>;
  availableRoles: Roles;
}

/** The effective item-level role list for a user. */
export const describeAccessRoles = (input: DescribeAccessInput): Roles => {
  if (input.isRegistryAdmin) return [...input.availableRoles];
  if (input.settings.owner === input.username) return [...input.availableRoles];
  const roles = determineUserAccess(input.settings, input.userGroupIds);
  return roles.filter((role) => input.availableRoles.includes(role));
};

export const defaultAccessSettings = (
  username: string,
  defaultRoles: Roles,
): AccessSettingsLike => ({
  owner: username,
  general: [...defaultRoles],
  groups: {},
});
