/**
 * Auth + lock sidecar repositories.
 */
import { asc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { itemAuth, itemLock, lockEvent } from "../schema/sidecars.js";

export interface AccessSettingsRecord {
  owner: string;
  general: string[];
  groups: Record<string, string[]>;
}

export const makeAuthRepo = (db: Database) => {
  const getAccessSettings = async (itemId: string): Promise<AccessSettingsRecord | null> => {
    const rows = await db.select().from(itemAuth).where(eq(itemAuth.itemId, itemId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { owner: row.owner, general: row.generalRoles, groups: row.groupRoles };
  };

  const putAccessSettings = async (
    itemId: string,
    settings: AccessSettingsRecord,
  ): Promise<void> => {
    await db
      .insert(itemAuth)
      .values({
        itemId,
        owner: settings.owner,
        generalRoles: settings.general,
        groupRoles: settings.groups,
      })
      .onConflictDoUpdate({
        target: itemAuth.itemId,
        set: {
          owner: settings.owner,
          generalRoles: settings.general,
          groupRoles: settings.groups,
        },
      });
  };

  return { getAccessSettings, putAccessSettings };
};

export type AuthRepo = ReturnType<typeof makeAuthRepo>;

export interface LockEventRecord {
  action_type: "LOCK" | "UNLOCK";
  username: string;
  email: string | null;
  reason: string;
  timestamp: number;
}

export const makeLockRepo = (db: Database) => {
  const isLocked = async (itemId: string): Promise<boolean> => {
    const rows = await db.select().from(itemLock).where(eq(itemLock.itemId, itemId)).limit(1);
    return rows[0]?.locked ?? false;
  };

  const setLocked = async (
    itemId: string,
    locked: boolean,
    event: Omit<LockEventRecord, "action_type">,
  ): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx
        .insert(itemLock)
        .values({ itemId, locked })
        .onConflictDoUpdate({ target: itemLock.itemId, set: { locked } });
      await tx.insert(lockEvent).values({
        itemId,
        actionType: locked ? "LOCK" : "UNLOCK",
        username: event.username,
        email: event.email,
        reason: event.reason,
        timestamp: event.timestamp,
      });
    });
  };

  const lockHistory = async (itemId: string): Promise<LockEventRecord[]> => {
    const rows = await db
      .select()
      .from(lockEvent)
      .where(eq(lockEvent.itemId, itemId))
      .orderBy(asc(lockEvent.id));
    return rows.map((r) => ({
      action_type: r.actionType,
      username: r.username,
      email: r.email,
      reason: r.reason,
      timestamp: r.timestamp,
    }));
  };

  return { isLocked, setLocked, lockHistory };
};

export type LockRepo = ReturnType<typeof makeLockRepo>;
