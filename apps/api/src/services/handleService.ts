import { randomUUID } from "node:crypto";
import type { DbClient } from "@provena/db";
import { eq, handles } from "@provena/db";
import { statusPayload } from "../utils/http";

type HandleRecord = typeof handles.$inferSelect;

const now = (): Date => new Date();

const nextIndex = (values: Array<{ index: number }>): number =>
  values.reduce((max, entry) => Math.max(max, entry.index), 0) + 1;

const sortedValues = (
  values: Array<{ index: number; type: string; value: string }>,
): Array<{ index: number; type: string; value: string }> =>
  values.slice().sort((a, b) => a.index - b.index);

const mapHandle = (record: HandleRecord) => ({
  status: statusPayload(true),
  id: record.handle,
  values: sortedValues(record.values),
});

const fetchHandle = async (db: DbClient, handleId: string): Promise<HandleRecord | null> => {
  const [existing] = await db.select().from(handles).where(eq(handles.handle, handleId)).limit(1);
  return existing ?? null;
};

export interface HandleService {
  mint: (value: string, valueType: string, username: string) => Promise<Record<string, unknown>>;
  addValue: (id: string, value: string, valueType: string) => Promise<Record<string, unknown>>;
  addValueByIndex: (
    id: string,
    index: number,
    value: string,
    valueType: string,
  ) => Promise<Record<string, unknown>>;
  get: (id: string) => Promise<Record<string, unknown>>;
  list: () => Promise<{ status: ReturnType<typeof statusPayload>; ids: string[] }>;
  modifyByIndex: (id: string, index: number, value: string) => Promise<Record<string, unknown>>;
  removeByIndex: (id: string, index: number) => Promise<Record<string, unknown>>;
}

const errorResponse = (details: string): Record<string, unknown> => ({
  status: statusPayload(false, details),
});

export const createHandleService = (db: DbClient): HandleService => ({
  mint: async (value, valueType, username) => {
    const handleId = `hdl:${username}:${randomUUID()}`;
    const [created] = await db
      .insert(handles)
      .values({
        handle: handleId,
        values: [{ index: 1, type: valueType, value }],
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();

    if (!created) {
      return errorResponse("Failed to mint handle");
    }
    return mapHandle(created);
  },
  addValue: async (id, value, valueType) => {
    const existing = await fetchHandle(db, id);
    if (!existing) {
      return errorResponse("Handle not found");
    }
    const [updated] = await db
      .update(handles)
      .set({
        values: [...existing.values, { index: nextIndex(existing.values), type: valueType, value }],
        updatedAt: now(),
      })
      .where(eq(handles.id, existing.id))
      .returning();
    return mapHandle(updated ?? existing);
  },
  addValueByIndex: async (id, index, value, valueType) => {
    const existing = await fetchHandle(db, id);
    if (!existing) {
      return errorResponse("Handle not found");
    }
    const [updated] = await db
      .update(handles)
      .set({
        values: [
          ...existing.values.filter((entry) => entry.index !== index),
          { index, type: valueType, value },
        ],
        updatedAt: now(),
      })
      .where(eq(handles.id, existing.id))
      .returning();
    return mapHandle(updated ?? existing);
  },
  get: async (id) => {
    const existing = await fetchHandle(db, id);
    if (!existing) {
      return errorResponse("Handle not found");
    }
    return mapHandle(existing);
  },
  list: async () => {
    const records = await db.select().from(handles);
    return {
      status: statusPayload(true),
      ids: records.map((record) => record.handle),
    };
  },
  modifyByIndex: async (id, index, value) => {
    const existing = await fetchHandle(db, id);
    if (!existing) {
      return errorResponse("Handle not found");
    }
    const [updated] = await db
      .update(handles)
      .set({
        values: existing.values.map((entry) => (entry.index === index ? { ...entry, value } : entry)),
        updatedAt: now(),
      })
      .where(eq(handles.id, existing.id))
      .returning();
    return mapHandle(updated ?? existing);
  },
  removeByIndex: async (id, index) => {
    const existing = await fetchHandle(db, id);
    if (!existing) {
      return errorResponse("Handle not found");
    }
    const [updated] = await db
      .update(handles)
      .set({
        values: existing.values.filter((entry) => entry.index !== index),
        updatedAt: now(),
      })
      .where(eq(handles.id, existing.id))
      .returning();
    return mapHandle(updated ?? existing);
  },
});
