/**
 * Repositories for groups, access requests, user-person links, handles,
 * job sessions and dataset reviewers.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { JobStatus, JobSubType, JobType } from "@provena/interfaces/types/AsyncJobModels";
import type { Database } from "../client.js";
import {
  accessRequest,
  datasetReviewer,
  handle,
  jobSession,
  userGroup,
  userGroupMember,
  userPersonLink,
} from "../schema/auxiliary.js";
import type { HandleProperty } from "@provena/interfaces/types/HandleModels";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/* --------------------------------- groups -------------------------------- */

export interface GroupMetadataRecord {
  id: string;
  display_name: string;
  description: string;
  default_data_store_access?: string[] | null;
}

export interface GroupUserRecord {
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export const makeGroupRepo = (db: Database) => {
  const listGroups = async (): Promise<GroupMetadataRecord[]> => {
    const rows = await db.select().from(userGroup);
    return rows.map((r) => ({
      id: r.id,
      display_name: r.displayName,
      description: r.description,
      default_data_store_access: r.defaultDataStoreAccess,
    }));
  };

  const getGroup = async (id: string): Promise<GroupMetadataRecord | null> => {
    const rows = await db.select().from(userGroup).where(eq(userGroup.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      display_name: row.displayName,
      description: row.description,
      default_data_store_access: row.defaultDataStoreAccess,
    };
  };

  const putGroup = async (group: GroupMetadataRecord): Promise<void> => {
    await db
      .insert(userGroup)
      .values({
        id: group.id,
        displayName: group.display_name,
        description: group.description,
        defaultDataStoreAccess: group.default_data_store_access ?? null,
      })
      .onConflictDoUpdate({
        target: userGroup.id,
        set: {
          displayName: group.display_name,
          description: group.description,
          defaultDataStoreAccess: group.default_data_store_access ?? null,
        },
      });
  };

  const removeGroup = async (id: string): Promise<boolean> => {
    const rows = await db.delete(userGroup).where(eq(userGroup.id, id)).returning();
    return rows.length > 0;
  };

  const listMembers = async (groupId: string): Promise<GroupUserRecord[]> => {
    const rows = await db
      .select()
      .from(userGroupMember)
      .where(eq(userGroupMember.groupId, groupId));
    return rows.map((r) => ({
      username: r.username,
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
    }));
  };

  const isMember = async (groupId: string, username: string): Promise<boolean> => {
    const rows = await db
      .select({ username: userGroupMember.username })
      .from(userGroupMember)
      .where(and(eq(userGroupMember.groupId, groupId), eq(userGroupMember.username, username)))
      .limit(1);
    return rows.length > 0;
  };

  const addMember = async (groupId: string, user: GroupUserRecord): Promise<void> => {
    await db
      .insert(userGroupMember)
      .values({
        groupId,
        username: user.username,
        email: user.email ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
      })
      .onConflictDoUpdate({
        target: [userGroupMember.groupId, userGroupMember.username],
        set: {
          email: user.email ?? null,
          firstName: user.first_name ?? null,
          lastName: user.last_name ?? null,
        },
      });
  };

  const removeMember = async (groupId: string, username: string): Promise<boolean> => {
    const rows = await db
      .delete(userGroupMember)
      .where(and(eq(userGroupMember.groupId, groupId), eq(userGroupMember.username, username)))
      .returning();
    return rows.length > 0;
  };

  const groupsForUser = async (username: string): Promise<GroupMetadataRecord[]> => {
    const rows = await db
      .select({ group: userGroup })
      .from(userGroupMember)
      .innerJoin(userGroup, eq(userGroup.id, userGroupMember.groupId))
      .where(eq(userGroupMember.username, username));
    return rows.map(({ group }) => ({
      id: group.id,
      display_name: group.displayName,
      description: group.description,
      default_data_store_access: group.defaultDataStoreAccess,
    }));
  };

  const replaceMembers = async (groupId: string, users: GroupUserRecord[]): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.delete(userGroupMember).where(eq(userGroupMember.groupId, groupId));
      if (users.length > 0) {
        await tx.insert(userGroupMember).values(
          users.map((u) => ({
            groupId,
            username: u.username,
            email: u.email ?? null,
            firstName: u.first_name ?? null,
            lastName: u.last_name ?? null,
          })),
        );
      }
    });
  };

  return {
    listGroups,
    getGroup,
    putGroup,
    removeGroup,
    listMembers,
    isMember,
    addMember,
    removeMember,
    groupsForUser,
    replaceMembers,
  };
};

export type GroupRepo = ReturnType<typeof makeGroupRepo>;

/* ----------------------------- access requests --------------------------- */

export interface AccessRequestRecord {
  username: string;
  request_id: number;
  expiry: number;
  email: string;
  created_timestamp: number;
  updated_timestamp: number;
  status: "PENDING_APPROVAL" | "APPROVED_PENDING_ACTION" | "DENIED_PENDING_DELETION" | "ACTIONED_PENDING_DELETION";
  ui_friendly_status: string;
  request_diff_contents: string;
  complete_contents: string;
  notes: string;
}

export const makeAccessRequestRepo = (db: Database) => {
  const toRecord = (r: typeof accessRequest.$inferSelect): AccessRequestRecord => ({
    username: r.username,
    request_id: r.requestId,
    expiry: r.expiry,
    email: r.email,
    created_timestamp: r.createdTimestamp,
    updated_timestamp: r.updatedTimestamp,
    status: r.status,
    ui_friendly_status: r.uiFriendlyStatus,
    request_diff_contents: r.requestDiffContents,
    complete_contents: r.completeContents,
    notes: r.notes,
  });

  const create = async (record: AccessRequestRecord): Promise<void> => {
    await db.insert(accessRequest).values({
      username: record.username,
      requestId: record.request_id,
      email: record.email,
      status: record.status,
      uiFriendlyStatus: record.ui_friendly_status,
      createdTimestamp: record.created_timestamp,
      updatedTimestamp: record.updated_timestamp,
      expiry: record.expiry,
      requestDiffContents: record.request_diff_contents,
      completeContents: record.complete_contents,
      notes: record.notes,
    });
  };

  const get = async (username: string, requestId: number): Promise<AccessRequestRecord | null> => {
    const rows = await db
      .select()
      .from(accessRequest)
      .where(and(eq(accessRequest.username, username), eq(accessRequest.requestId, requestId)))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  };

  const listForUser = async (username: string): Promise<AccessRequestRecord[]> => {
    const rows = await db
      .select()
      .from(accessRequest)
      .where(eq(accessRequest.username, username))
      .orderBy(desc(accessRequest.createdTimestamp));
    return rows.map(toRecord);
  };

  const listAll = async (): Promise<AccessRequestRecord[]> => {
    const rows = await db
      .select()
      .from(accessRequest)
      .orderBy(desc(accessRequest.createdTimestamp));
    return rows.map(toRecord);
  };

  const update = async (
    username: string,
    requestId: number,
    updates: Partial<Pick<AccessRequestRecord, "status" | "ui_friendly_status" | "notes" | "updated_timestamp">>,
  ): Promise<boolean> => {
    const rows = await db
      .update(accessRequest)
      .set({
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.ui_friendly_status !== undefined
          ? { uiFriendlyStatus: updates.ui_friendly_status }
          : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
        updatedTimestamp: updates.updated_timestamp ?? nowSeconds(),
      })
      .where(and(eq(accessRequest.username, username), eq(accessRequest.requestId, requestId)))
      .returning();
    return rows.length > 0;
  };

  const remove = async (username: string, requestId: number): Promise<boolean> => {
    const rows = await db
      .delete(accessRequest)
      .where(and(eq(accessRequest.username, username), eq(accessRequest.requestId, requestId)))
      .returning();
    return rows.length > 0;
  };

  return { create, get, listForUser, listAll, update, remove };
};

export type AccessRequestRepo = ReturnType<typeof makeAccessRequestRepo>;

/* ------------------------------ user links ------------------------------- */

export const makeLinkRepo = (db: Database) => {
  const lookup = async (username: string): Promise<string | null> => {
    const rows = await db
      .select()
      .from(userPersonLink)
      .where(eq(userPersonLink.username, username))
      .limit(1);
    return rows[0]?.personId ?? null;
  };

  const reverseLookup = async (personId: string): Promise<string[]> => {
    const rows = await db
      .select()
      .from(userPersonLink)
      .where(eq(userPersonLink.personId, personId));
    return rows.map((r) => r.username);
  };

  const assign = async (username: string, personId: string): Promise<void> => {
    await db
      .insert(userPersonLink)
      .values({ username, personId })
      .onConflictDoUpdate({ target: userPersonLink.username, set: { personId } });
  };

  const clear = async (username: string): Promise<boolean> => {
    const rows = await db
      .delete(userPersonLink)
      .where(eq(userPersonLink.username, username))
      .returning();
    return rows.length > 0;
  };

  return { lookup, reverseLookup, assign, clear };
};

export type LinkRepo = ReturnType<typeof makeLinkRepo>;

/* -------------------------------- handles -------------------------------- */

export const makeHandleRepo = (db: Database) => {
  const mint = async (prefix: string, firstProperty: HandleProperty): Promise<string> => {
    /* Sequence-backed suffix for collision-free minting. */
    const seqRow = await db.execute(
      sql`SELECT nextval('handle_suffix_seq')::bigint AS suffix`,
    );
    const suffix = (seqRow.rows[0] as { suffix: string | number }).suffix;
    const id = `${prefix}/${suffix}`;
    await db.insert(handle).values({ id, properties: [firstProperty] });
    return id;
  };

  const get = async (id: string): Promise<HandleProperty[] | null> => {
    const rows = await db.select().from(handle).where(eq(handle.id, id)).limit(1);
    return rows[0]?.properties ?? null;
  };

  const list = async (): Promise<string[]> => {
    const rows = await db.select({ id: handle.id }).from(handle);
    return rows.map((r) => r.id);
  };

  const setProperties = async (id: string, properties: HandleProperty[]): Promise<void> => {
    await db.update(handle).set({ properties }).where(eq(handle.id, id));
  };

  return { mint, get, list, setProperties };
};

export type HandleRepo = ReturnType<typeof makeHandleRepo>;

/* ------------------------------ job sessions ----------------------------- */

export interface JobSessionRecord {
  session_id: string;
  created_timestamp: number;
  username: string;
  batch_id: string | null;
  job_type: JobType;
  job_sub_type: JobSubType;
  payload: Record<string, unknown>;
  status: JobStatus;
  info: string | null;
  result: Record<string, unknown> | null;
}

export interface JobListOptions {
  username?: string | null;
  batchId?: string | null;
  limit?: number;
  /** created_timestamp cursor (exclusive, descending). */
  paginationKey?: Record<string, unknown> | null;
}

export const makeJobRepo = (db: Database) => {
  const toRecord = (r: typeof jobSession.$inferSelect): JobSessionRecord => ({
    session_id: r.sessionId,
    created_timestamp: r.createdTimestamp,
    username: r.username,
    batch_id: r.batchId,
    job_type: r.jobType,
    job_sub_type: r.jobSubType,
    payload: r.payload,
    status: r.status,
    info: r.info,
    result: r.result,
  });

  const create = async (input: {
    username: string;
    jobType: JobType;
    jobSubType: JobSubType;
    payload: Record<string, unknown>;
    batchId?: string | null;
    sessionId?: string;
  }): Promise<JobSessionRecord> => {
    const sessionId = input.sessionId ?? uuidv4();
    const rows = await db
      .insert(jobSession)
      .values({
        sessionId,
        createdTimestamp: nowSeconds(),
        username: input.username,
        batchId: input.batchId ?? null,
        jobType: input.jobType,
        jobSubType: input.jobSubType,
        payload: input.payload,
        status: "PENDING",
      })
      .returning();
    return toRecord(rows[0]!);
  };

  const get = async (sessionId: string): Promise<JobSessionRecord | null> => {
    const rows = await db
      .select()
      .from(jobSession)
      .where(eq(jobSession.sessionId, sessionId))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  };

  const setStatus = async (
    sessionId: string,
    status: JobStatus,
    info?: string | null,
    result?: Record<string, unknown> | null,
  ): Promise<void> => {
    await db
      .update(jobSession)
      .set({
        status,
        ...(info !== undefined ? { info } : {}),
        ...(result !== undefined ? { result } : {}),
      })
      .where(eq(jobSession.sessionId, sessionId));
  };

  const list = async (
    options: JobListOptions,
  ): Promise<{ jobs: JobSessionRecord[]; paginationKey: Record<string, unknown> | null }> => {
    const limit = options.limit ?? 10;
    const conditions = [];
    if (options.username) conditions.push(eq(jobSession.username, options.username));
    if (options.batchId) conditions.push(eq(jobSession.batchId, options.batchId));
    const cursorRaw = options.paginationKey?.ts;
    const cursorId = options.paginationKey?.sid;
    if (typeof cursorRaw === "number" && typeof cursorId === "string") {
      const cursorCondition = sql`(${jobSession.createdTimestamp}, ${jobSession.sessionId}) < (${cursorRaw}, ${cursorId})`;
      conditions.push(cursorCondition);
    }
    const rows = await db
      .select()
      .from(jobSession)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(jobSession.createdTimestamp), desc(jobSession.sessionId))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      jobs: page.map(toRecord),
      paginationKey:
        hasMore && last ? { ts: last.createdTimestamp, sid: last.sessionId } : null,
    };
  };

  return { create, get, setStatus, list };
};

export type JobRepo = ReturnType<typeof makeJobRepo>;

/* ----------------------------- dataset reviewers ------------------------- */

export const makeReviewerRepo = (db: Database) => {
  const list = async (): Promise<string[]> => {
    const rows = await db.select().from(datasetReviewer);
    return rows.map((r) => r.id);
  };
  const add = async (id: string): Promise<void> => {
    await db.insert(datasetReviewer).values({ id }).onConflictDoNothing();
  };
  const remove = async (id: string): Promise<boolean> => {
    const rows = await db.delete(datasetReviewer).where(eq(datasetReviewer.id, id)).returning();
    return rows.length > 0;
  };
  const isReviewer = async (id: string): Promise<boolean> => {
    const rows = await db
      .select()
      .from(datasetReviewer)
      .where(eq(datasetReviewer.id, id))
      .limit(1);
    return rows.length > 0;
  };
  return { list, add, remove, isReviewer };
};

export type ReviewerRepo = ReturnType<typeof makeReviewerRepo>;
