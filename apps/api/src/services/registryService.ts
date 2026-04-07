import {
  and,
  desc,
  eq,
  registryItemHistory,
  registryItems,
  registryLockEvents,
  registryLocks,
  type DbClient,
  type RegistryRepository,
} from "@provena/db";
import { randomUUID } from "node:crypto";
import { statusPayload } from "../utils/http";

type RegistryItemRow = Awaited<ReturnType<RegistryRepository["fetchById"]>>;

const toIso = (value: Date): string => value.toISOString();

const mapRegistryItem = (item: NonNullable<RegistryItemRow>) => ({
  id: item.id,
  category: item.category,
  subtype: item.subtype,
  version: item.version,
  display_name: item.displayName,
  owner_username: item.ownerUsername,
  record: item.record,
  created_at: toIso(item.createdAt),
  updated_at: toIso(item.updatedAt),
});

export interface RegistryService {
  list: (input: {
    category?: string;
    subtype?: string;
    filter?: string;
    limit: number;
    offset: number;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; records: ReturnType<typeof mapRegistryItem>[]; count: number }>;
  fetch: (id: string) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapRegistryItem> | null }>;
  create: (input: {
    id?: string;
    category: string;
    subtype: string;
    displayName: string;
    ownerUsername: string;
    record: Record<string, unknown>;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapRegistryItem> }>;
  update: (input: {
    id: string;
    displayName?: string;
    updatedBy: string;
    record: Record<string, unknown>;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapRegistryItem> | null }>;
  version: (input: {
    id: string;
    reason?: string;
    updatedBy: string;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapRegistryItem> | null }>;
  revert: (input: {
    id: string;
    historyId?: string;
    updatedBy: string;
  }) => Promise<{ status: ReturnType<typeof statusPayload>; item: ReturnType<typeof mapRegistryItem> | null }>;
  getAuthConfiguration: (id: string) => Promise<{
    status: ReturnType<typeof statusPayload>;
    configuration: {
      open_access: boolean;
      groups: Array<{ group_name: string; roles: string[] }>;
    };
  }>;
  setAuthConfiguration: (input: {
    id: string;
    openAccess: boolean;
    groups: Array<{ group_name: string; roles: string[] }>;
  }) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  lock: (id: string, actor: string, reason?: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  unlock: (id: string, actor: string, reason?: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
  lockHistory: (id: string) => Promise<{
    status: ReturnType<typeof statusPayload>;
    events: Array<{ action: string; actor_username: string; reason: string | null; created_at: string }>;
  }>;
  isLocked: (id: string) => Promise<{ status: ReturnType<typeof statusPayload>; locked: boolean }>;
  delete: (id: string) => Promise<{ status: ReturnType<typeof statusPayload> }>;
}

export const createRegistryService = (
  db: DbClient,
  repository: RegistryRepository,
): RegistryService => ({
  list: async (input) => {
    const listed = await repository.list({
      category: input.category,
      subtype: input.subtype,
      filter: input.filter,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      status: statusPayload(true),
      records: listed.records.map(mapRegistryItem),
      count: listed.total,
    };
  },
  fetch: async (id) => {
    const item = await repository.fetchById(id);
    return {
      status: statusPayload(Boolean(item), item ? "Registry item fetched." : "Registry item not found."),
      item: item ? mapRegistryItem(item) : null,
    };
  },
  create: async (input) => {
    const id = input.id ?? `${input.category}:${input.subtype}:${randomUUID()}`;
    const created = await repository.create({
      id,
      category: input.category,
      subtype: input.subtype,
      displayName: input.displayName,
      ownerUsername: input.ownerUsername,
      record: input.record,
    });
    return {
      status: statusPayload(true, "Registry item created."),
      item: mapRegistryItem(created),
    };
  },
  update: async (input) => {
    const existing = await repository.fetchById(input.id);
    if (!existing) {
      return {
        status: statusPayload(false, `No item with id ${input.id} was found.`),
        item: null,
      };
    }
    const updated = await repository.update({
      id: input.id,
      displayName: input.displayName,
      updatedBy: input.updatedBy,
      record: input.record,
    });
    return {
      status: statusPayload(true, "Registry item updated."),
      item: mapRegistryItem(updated),
    };
  },
  version: async ({ id, reason, updatedBy }) => {
    const existing = await repository.fetchById(id);
    if (!existing) {
      return {
        status: statusPayload(false, `No item with id ${id} was found.`),
        item: null,
      };
    }

    await db.insert(registryItemHistory).values({
      itemId: existing.id,
      version: existing.version,
      record: existing.record,
      changedBy: updatedBy,
      reason: reason ?? null,
    });

    const updated = await repository.update({
      id,
      updatedBy,
      displayName: existing.displayName,
      record: existing.record,
    });
    return {
      status: statusPayload(true, "Version operation completed."),
      item: mapRegistryItem(updated),
    };
  },
  revert: async ({ id, historyId, updatedBy }) => {
    const existing = await repository.fetchById(id);
    if (!existing) {
      return {
        status: statusPayload(false, `No item with id ${id} was found.`),
        item: null,
      };
    }

    const [historyEntry] = await db
      .select()
      .from(registryItemHistory)
      .where(
        historyId
          ? and(eq(registryItemHistory.id, historyId), eq(registryItemHistory.itemId, id))
          : eq(registryItemHistory.itemId, id),
      )
      .orderBy(desc(registryItemHistory.createdAt))
      .limit(1);

    if (!historyEntry) {
      return {
        status: statusPayload(false, `No history entry found for item ${id}.`),
        item: null,
      };
    }

    const updated = await repository.update({
      id,
      updatedBy,
      displayName: existing.displayName,
      record: historyEntry.record,
    });
    return {
      status: statusPayload(true, "Revert operation completed."),
      item: mapRegistryItem(updated),
    };
  },
  getAuthConfiguration: async (id) => {
    const roles = await repository.getAccessRoles(id);
    const grouped = new Map<string, string[]>();
    for (const entry of roles.groupRoles) {
      const existing = grouped.get(entry.groupName) ?? [];
      existing.push(entry.role);
      grouped.set(entry.groupName, existing);
    }

    return {
      status: statusPayload(true),
      configuration: {
        open_access: roles.openAccess,
        groups: Array.from(grouped.entries()).map(([group_name, roleList]) => ({
          group_name,
          roles: roleList,
        })),
      },
    };
  },
  setAuthConfiguration: async (input) => {
    await repository.setAccessRoles({
      itemId: input.id,
      openAccess: input.openAccess,
      groupRoles: input.groups.flatMap((group) =>
        group.roles.map((role) => ({
          groupName: group.group_name,
          role,
        })),
      ),
    });
    return {
      status: statusPayload(true, "Access configuration updated."),
    };
  },
  lock: async (id, actor, reason) => {
    await db
      .insert(registryLocks)
      .values({
        itemId: id,
        locked: true,
        reason: reason ?? null,
        lockedBy: actor,
      })
      .onConflictDoUpdate({
        target: registryLocks.itemId,
        set: {
          locked: true,
          reason: reason ?? null,
          lockedBy: actor,
          updatedAt: new Date(),
        },
      });

    await db.insert(registryLockEvents).values({
      itemId: id,
      action: "lock",
      actorUsername: actor,
      reason: reason ?? null,
    });

    return {
      status: statusPayload(true, "Item locked."),
    };
  },
  unlock: async (id, actor, reason) => {
    await db
      .insert(registryLocks)
      .values({
        itemId: id,
        locked: false,
        reason: reason ?? null,
        lockedBy: actor,
      })
      .onConflictDoUpdate({
        target: registryLocks.itemId,
        set: {
          locked: false,
          reason: reason ?? null,
          lockedBy: actor,
          updatedAt: new Date(),
        },
      });

    await db.insert(registryLockEvents).values({
      itemId: id,
      action: "unlock",
      actorUsername: actor,
      reason: reason ?? null,
    });

    return {
      status: statusPayload(true, "Item unlocked."),
    };
  },
  lockHistory: async (id) => {
    const events = await db
      .select()
      .from(registryLockEvents)
      .where(eq(registryLockEvents.itemId, id))
      .orderBy(desc(registryLockEvents.createdAt));

    return {
      status: statusPayload(true),
      events: events.map((event) => ({
        action: event.action,
        actor_username: event.actorUsername,
        reason: event.reason ?? null,
        created_at: toIso(event.createdAt),
      })),
    };
  },
  isLocked: async (id) => {
    const [entry] = await db.select().from(registryLocks).where(eq(registryLocks.itemId, id)).limit(1);
    return {
      status: statusPayload(true),
      locked: entry?.locked ?? false,
    };
  },
  delete: async (id) => {
    const deleted = await db.delete(registryItems).where(eq(registryItems.id, id)).returning();
    return {
      status: statusPayload(Boolean(deleted[0]), deleted[0] ? "Deleted." : "Item not found."),
    };
  },
});
