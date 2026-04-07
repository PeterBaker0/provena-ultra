import type { AuthRepository } from "@provena/db";
import type { AccessRequestStatus } from "@provena/contracts";
import { statusPayload } from "../utils/http";

type GroupRow = Awaited<ReturnType<AuthRepository["describeGroup"]>>;
type GroupMemberRow = Awaited<ReturnType<AuthRepository["listMembers"]>>[number];
type AccessRequestRow = Awaited<ReturnType<AuthRepository["listAccessRequests"]>>[number];
type UserLinkRow = Awaited<ReturnType<AuthRepository["findUserLinkByUsername"]>>;

const toIso = (value: Date): string => value.toISOString();

const mapGroup = (group: NonNullable<GroupRow>) => ({
  id: group.name,
  name: group.name,
  description: group.description ?? null,
  created_at: toIso(group.createdAt),
  updated_at: toIso(group.updatedAt),
});

const mapMember = (member: GroupMemberRow) => ({
  username: member.username,
});

const mapAccessRequest = (request: AccessRequestRow) => ({
  id: request.id,
  request_id: request.id,
  username: request.username,
  requestedRoles: request.requestedRoles,
  requested_roles: request.requestedRoles,
  reason: request.reason,
  status: request.status,
  notes: request.notes,
  created_at: toIso(request.createdAt),
  updated_at: toIso(request.updatedAt),
});

const mapUserLink = (link: NonNullable<UserLinkRow>) => ({
  username: link.username,
  person_id: link.personId,
  personId: link.personId,
  linked_by: link.linkedBy,
  linkedBy: link.linkedBy,
  created_at: toIso(link.createdAt),
  updated_at: toIso(link.updatedAt),
});

export interface AuthService {
  listGroups: (filter?: string) => Promise<{ status: ReturnType<typeof statusPayload>; groups: ReturnType<typeof mapGroup>[] }>;
  describeGroup: (id: string) => Promise<{ status: ReturnType<typeof statusPayload>; group: ReturnType<typeof mapGroup> | null }>;
  listMembers: (id: string) => Promise<{ status: ReturnType<typeof statusPayload>; group: { id: string; users: ReturnType<typeof mapMember>[] } | null }>;
  listUserMembership: (username: string) => Promise<{ status: ReturnType<typeof statusPayload>; groups: ReturnType<typeof mapGroup>[] }>;
  checkMembership: (groupId: string, username: string) => Promise<{ status: ReturnType<typeof statusPayload>; is_member: boolean }>;
  addMember: (groupId: string, username: string, addedBy: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  removeMember: (groupId: string, username: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  removeMembers: (groupId: string, usernames: string[]) => Promise<{ status: ReturnType<typeof statusPayload>; removed: number }>;
  addGroup: (id: string, description: string | null) => Promise<{ status: ReturnType<typeof statusPayload>; group: ReturnType<typeof mapGroup> }>;
  updateGroup: (id: string, description: string | null) => Promise<{ status: ReturnType<typeof statusPayload>; group: ReturnType<typeof mapGroup> | null }>;
  removeGroup: (id: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  exportGroups: () => Promise<{ status: ReturnType<typeof statusPayload>; items: Array<Record<string, unknown>> }>;
  importGroups: (items: Array<Record<string, unknown>>) => Promise<{ status: ReturnType<typeof statusPayload>; imported: number }>;
  restoreGroupsFromTable: (tableName: string) => Promise<{ status: ReturnType<typeof statusPayload>; table_name: string }>;
  requestAccessChange: (username: string, requestedRoles: string[], reason: string) => Promise<{ status: ReturnType<typeof statusPayload>; request: ReturnType<typeof mapAccessRequest> }>;
  listAccessRequests: (input: {
    pendingOnly: boolean;
    username?: string;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; items: ReturnType<typeof mapAccessRequest>[] }>;
  changeAccessRequestStatus: (
    id: string,
    status: AccessRequestStatus | "PENDING_APPROVAL",
    note?: string,
  ) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapAccessRequest> | null }>;
  addAccessRequestNote: (id: string, note: string) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapAccessRequest> | null }>;
  deleteAccessRequest: (id: string) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapAccessRequest> | null }>;
  generateAccessReport: (username: string) => Promise<string>;
  findUserLinkByUsername: (username: string) => Promise<{ status: ReturnType<typeof statusPayload>; person_id: string | null; link: ReturnType<typeof mapUserLink> | null }>;
  assignUserLink: (username: string, personId: string, linkedBy: string) => Promise<{ status: ReturnType<typeof statusPayload>; link: ReturnType<typeof mapUserLink> }>;
  clearUserLink: (username: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  reverseLookupUserLink: (personId: string) => Promise<{ status: ReturnType<typeof statusPayload>; usernames: string[] }>;
}

const resolveGroupId = async (repository: AuthRepository, inputId: string): Promise<string | null> => {
  const byName = await repository.describeGroup(inputId);
  if (byName) {
    return byName.name;
  }

  const groups = await repository.listGroups();
  const matched = groups.find((entry) => entry.id === inputId);
  return matched?.name ?? null;
};

const normalizeAccessRequestStatus = (
  status: AccessRequestStatus | "PENDING_APPROVAL",
): AccessRequestStatus => {
  if (status === "PENDING_APPROVAL") {
    return "PENDING";
  }
  return status;
};

export const createAuthService = (repository: AuthRepository): AuthService => ({
  listGroups: async (filter) => {
    const groups = await repository.listGroups(filter);
    return {
      status: statusPayload(true, `Retrieved ${groups.length} groups successfully`),
      groups: groups.map(mapGroup),
    };
  },
  describeGroup: async (id) => {
    const groupName = await resolveGroupId(repository, id);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${id} was found.`),
        group: null,
      };
    }
    const group = await repository.describeGroup(groupName);
    return {
      status: statusPayload(Boolean(group), group ? "Group metadata retrieved." : `No group with id ${id} was found.`),
      group: group ? mapGroup(group) : null,
    };
  },
  listMembers: async (id) => {
    const groupName = await resolveGroupId(repository, id);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${id} was found.`),
        group: null,
      };
    }
    const members = await repository.listMembers(groupName);
    return {
      status: statusPayload(true, `Group with ${members.length} users returned.`),
      group: {
        id: groupName,
        users: members.map(mapMember),
      },
    };
  },
  listUserMembership: async (username) => {
    const memberships = await repository.listUserMembership(username);
    const groups = await Promise.all(
      memberships.map(async (membership) => repository.describeGroup(membership.groupName)),
    );
    const result = groups.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map(mapGroup);
    return {
      status: statusPayload(true, `Member is part of ${result.length} groups as listed.`),
      groups: result,
    };
  },
  checkMembership: async (groupId, username) => {
    const groupName = await resolveGroupId(repository, groupId);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${groupId} was found.`),
        is_member: false,
      };
    }

    const count = await repository.countMembership(groupName, username);
    return {
      status: statusPayload(true, "Group was found and membership determined."),
      is_member: count > 0,
    };
  },
  addMember: async (groupId, username, addedBy) => {
    const groupName = await resolveGroupId(repository, groupId);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${groupId} was found.`),
      };
    }
    await repository.addMember(groupName, username, addedBy);
    return {
      status: statusPayload(true, `User added to group ${groupName} successfully.`),
    };
  },
  removeMember: async (groupId, username) => {
    const groupName = await resolveGroupId(repository, groupId);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${groupId} was found.`),
      };
    }
    await repository.removeMember(groupName, username);
    return {
      status: statusPayload(true, `User ${username} removed from group ${groupName} successfully.`),
    };
  },
  removeMembers: async (groupId, usernames) => {
    const groupName = await resolveGroupId(repository, groupId);
    if (!groupName) {
      return {
        status: statusPayload(false, `No group with id ${groupId} was found.`),
        removed: 0,
      };
    }
    const removed = await repository.removeMembers(groupName, usernames);
    return {
      status: statusPayload(true, `${removed} users were removed from group ${groupName} successfully.`),
      removed,
    };
  },
  addGroup: async (id, description) => {
    const created = await repository.createGroup({
      name: id,
      description,
    });
    return {
      status: statusPayload(true, `Successfully created group with id: ${id}.`),
      group: mapGroup(created),
    };
  },
  updateGroup: async (id, description) => {
    const updated = await repository.updateGroup({
      name: id,
      description,
    });
    return {
      status: statusPayload(Boolean(updated), updated ? `Successfully updated metadata for group with id: ${id}.` : `No group with id ${id} was found.`),
      group: updated ? mapGroup(updated) : null,
    };
  },
  removeGroup: async (id) => {
    const deleted = await repository.deleteGroup(id);
    return {
      status: statusPayload(Boolean(deleted), deleted ? `Successfully removed group with id: ${id}.` : `No group with id ${id} was found.`),
    };
  },
  exportGroups: async () => {
    const groups = await repository.listGroups();
    const items = await Promise.all(
      groups.map(async (group) => ({
        group: mapGroup(group),
        members: (await repository.listMembers(group.name)).map(mapMember),
      })),
    );
    return {
      status: statusPayload(true, `Successfully exported ${items.length} groups.`),
      items,
    };
  },
  importGroups: async (items) => {
    let imported = 0;
    for (const item of items) {
      const group = item.group as { id?: unknown; description?: unknown } | undefined;
      const id = typeof group?.id === "string" ? group.id : undefined;
      if (!id) {
        continue;
      }
      const description =
        typeof group?.description === "string" ? group.description : null;
      await repository.createGroup({
        name: id,
        description,
      });
      imported += 1;
    }

    return {
      status: statusPayload(true, `Imported ${imported} groups.`),
      imported,
    };
  },
  restoreGroupsFromTable: async (tableName) => ({
    status: statusPayload(false, "External table restore is not supported in PostgreSQL mode."),
    table_name: tableName,
  }),
  requestAccessChange: async (username, requestedRoles, reason) => {
    const request = await repository.createAccessRequest({
      username,
      requestedRoles,
      reason,
    });
    return {
      status: statusPayload(true, "Successfully requested an update to access."),
      request: mapAccessRequest(request),
    };
  },
  listAccessRequests: async ({ pendingOnly, username }) => {
    const requests = await repository.listAccessRequests(pendingOnly, username);
    return {
      status: statusPayload(true, `Retrieved ${requests.length} requests.`),
      items: requests.map(mapAccessRequest),
    };
  },
  changeAccessRequestStatus: async (id, status, note) => {
    const updated = await repository.updateAccessRequestStatus(
      id,
      normalizeAccessRequestStatus(status),
      note,
    );
    return {
      status: statusPayload(Boolean(updated), updated ? "Request updated." : "Request not found."),
      item: updated ? mapAccessRequest(updated) : null,
    };
  },
  addAccessRequestNote: async (id, note) => {
    const updated = await repository.appendAccessRequestNote(id, note);
    return {
      status: statusPayload(Boolean(updated), updated ? "Request updated." : "Request not found."),
      item: updated ? mapAccessRequest(updated) : null,
    };
  },
  deleteAccessRequest: async (id) => {
    const deleted = await repository.deleteAccessRequest(id);
    return {
      status: statusPayload(Boolean(deleted), deleted ? "Deleted record." : "Record was not found."),
      item: deleted ? mapAccessRequest(deleted) : null,
    };
  },
  generateAccessReport: async (username) => {
    const memberships = await repository.listUserMembership(username);
    const requests = await repository.listAccessRequests(true, username);
    return [
      `# Access report for ${username}`,
      "",
      `## Memberships (${memberships.length})`,
      ...memberships.map((membership) => `- ${membership.groupName}`),
      "",
      `## Pending requests (${requests.length})`,
      ...requests.map((request) => `- ${request.id}: ${request.status}`),
    ].join("\n");
  },
  findUserLinkByUsername: async (username) => {
    const link = await repository.findUserLinkByUsername(username);
    return {
      status: statusPayload(Boolean(link), link ? "Link found." : "No valid link was found."),
      person_id: link?.personId ?? null,
      link: link ? mapUserLink(link) : null,
    };
  },
  assignUserLink: async (username, personId, linkedBy) => {
    const link = await repository.upsertUserLink(username, personId, linkedBy);
    return {
      status: statusPayload(true, "Link updated."),
      link: mapUserLink(link),
    };
  },
  clearUserLink: async (username) => {
    const cleared = await repository.clearUserLink(username);
    return {
      status: statusPayload(Boolean(cleared), cleared ? "Link removed." : "No link existed."),
    };
  },
  reverseLookupUserLink: async (personId) => {
    const link = await repository.findUserLinkByPersonId(personId);
    return {
      status: statusPayload(true),
      usernames: link ? [link.username] : [],
    };
  },
});
