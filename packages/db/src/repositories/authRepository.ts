import { and, count, desc, eq, ilike, inArray } from "drizzle-orm";
import type { DbClient } from "../client";
import {
  accessRequests,
  groupMembers,
  groups,
  usernamePersonLinks,
} from "../schema";

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

export interface UpdateGroupInput {
  name: string;
  description?: string | null;
}

export interface CreateAccessRequestInput {
  username: string;
  requestedRoles: string[];
  reason: string;
}

export class AuthRepository {
  constructor(private readonly db: DbClient) {}

  async listGroups(filter?: string): Promise<(typeof groups.$inferSelect)[]> {
    const query = this.db
      .select()
      .from(groups)
      .orderBy(groups.name);

    if (!filter?.trim()) {
      return query;
    }

    return query.where(ilike(groups.name, `%${filter.trim()}%`));
  }

  async describeGroup(name: string): Promise<(typeof groups.$inferSelect) | null> {
    const [group] = await this.db.select().from(groups).where(eq(groups.name, name)).limit(1);
    return group ?? null;
  }

  async createGroup(input: CreateGroupInput): Promise<typeof groups.$inferSelect> {
    const [created] = await this.db
      .insert(groups)
      .values({
        name: input.name,
        description: input.description ?? null,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create group.");
    }
    return created;
  }

  async updateGroup(input: UpdateGroupInput): Promise<(typeof groups.$inferSelect) | null> {
    const [updated] = await this.db
      .update(groups)
      .set({
        description: input.description ?? null,
        updatedAt: new Date(),
      })
      .where(eq(groups.name, input.name))
      .returning();

    return updated ?? null;
  }

  async deleteGroup(name: string): Promise<(typeof groups.$inferSelect) | null> {
    const [deleted] = await this.db.delete(groups).where(eq(groups.name, name)).returning();
    return deleted ?? null;
  }

  async listMembers(groupName: string): Promise<(typeof groupMembers.$inferSelect)[]> {
    return this.db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupName, groupName))
      .orderBy(groupMembers.username);
  }

  async listUserMembership(username: string): Promise<(typeof groupMembers.$inferSelect)[]> {
    return this.db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.username, username))
      .orderBy(groupMembers.groupName);
  }

  async addMember(
    groupName: string,
    username: string,
    addedBy = "system",
  ): Promise<typeof groupMembers.$inferSelect> {
    const group = await this.describeGroup(groupName);
    if (!group) {
      throw new Error(`Group ${groupName} not found.`);
    }

    const [created] = await this.db
      .insert(groupMembers)
      .values({
        groupName,
        username,
        addedBy,
      })
      .onConflictDoNothing({
        target: [groupMembers.groupName, groupMembers.username],
      })
      .returning();

    if (created) {
      return created;
    }

    const [existing] = await this.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupName, groupName), eq(groupMembers.username, username)))
      .limit(1);

    if (!existing) {
      throw new Error("Failed to add or locate group membership.");
    }

    return existing;
  }

  async removeMember(groupName: string, username: string): Promise<(typeof groupMembers.$inferSelect) | null> {
    const [deleted] = await this.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupName, groupName), eq(groupMembers.username, username)))
      .returning();
    return deleted ?? null;
  }

  async removeMembers(groupName: string, usernames: string[]): Promise<number> {
    if (usernames.length === 0) {
      return 0;
    }

    const deleted = await this.db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupName, groupName),
          inArray(groupMembers.username, usernames),
        ),
      )
      .returning({ username: groupMembers.username });

    return deleted.length;
  }

  async createAccessRequest(input: CreateAccessRequestInput): Promise<typeof accessRequests.$inferSelect> {
    const [created] = await this.db
      .insert(accessRequests)
      .values({
        username: input.username,
        requestedRoles: input.requestedRoles,
        reason: input.reason,
      })
      .returning();
    if (!created) {
      throw new Error("Failed to create access request.");
    }
    return created;
  }

  async listAccessRequests(
    pendingOnly: boolean,
    username?: string,
  ): Promise<(typeof accessRequests.$inferSelect)[]> {
    const conditions = [];
    if (pendingOnly) {
      conditions.push(eq(accessRequests.status, "PENDING"));
    }
    if (username) {
      conditions.push(eq(accessRequests.username, username));
    }

    const query = this.db.select().from(accessRequests).orderBy(desc(accessRequests.updatedAt));
    if (conditions.length === 0) {
      return query;
    }

    return query.where(and(...conditions));
  }

  async updateAccessRequestStatus(
    id: string,
    status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
    note?: string,
  ): Promise<(typeof accessRequests.$inferSelect) | null> {
    const [existing] = await this.db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
    if (!existing) {
      return null;
    }

    const nextNotes = note ? [...existing.notes, note] : existing.notes;

    const [updated] = await this.db
      .update(accessRequests)
      .set({
        status,
        notes: nextNotes,
        updatedAt: new Date(),
      })
      .where(eq(accessRequests.id, id))
      .returning();

    return updated ?? null;
  }

  async appendAccessRequestNote(
    id: string,
    note: string,
  ): Promise<(typeof accessRequests.$inferSelect) | null> {
    const [existing] = await this.db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, id))
      .limit(1);
    if (!existing) {
      return null;
    }

    const [updated] = await this.db
      .update(accessRequests)
      .set({
        notes: [...existing.notes, note],
        updatedAt: new Date(),
      })
      .where(eq(accessRequests.id, id))
      .returning();
    return updated ?? null;
  }

  async deleteAccessRequest(id: string): Promise<(typeof accessRequests.$inferSelect) | null> {
    const [deleted] = await this.db.delete(accessRequests).where(eq(accessRequests.id, id)).returning();
    return deleted ?? null;
  }

  async upsertUserLink(
    username: string,
    personId: string,
    linkedBy: string,
  ): Promise<typeof usernamePersonLinks.$inferSelect> {
    const [link] = await this.db
      .insert(usernamePersonLinks)
      .values({
        username,
        personId,
        linkedBy,
      })
      .onConflictDoUpdate({
        target: usernamePersonLinks.username,
        set: {
          personId,
          linkedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!link) {
      throw new Error("Failed to upsert user link.");
    }
    return link;
  }

  async findUserLinkByUsername(
    username: string,
  ): Promise<(typeof usernamePersonLinks.$inferSelect) | null> {
    const [link] = await this.db
      .select()
      .from(usernamePersonLinks)
      .where(eq(usernamePersonLinks.username, username))
      .limit(1);
    return link ?? null;
  }

  async findUserLinkByPersonId(
    personId: string,
  ): Promise<(typeof usernamePersonLinks.$inferSelect) | null> {
    const [link] = await this.db
      .select()
      .from(usernamePersonLinks)
      .where(eq(usernamePersonLinks.personId, personId))
      .limit(1);
    return link ?? null;
  }

  async clearUserLink(username: string): Promise<(typeof usernamePersonLinks.$inferSelect) | null> {
    const [deleted] = await this.db
      .delete(usernamePersonLinks)
      .where(eq(usernamePersonLinks.username, username))
      .returning();
    return deleted ?? null;
  }

  async countMembership(groupName: string, username: string): Promise<number> {
    const [result] = await this.db
      .select({ total: count() })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupName, groupName), eq(groupMembers.username, username)));
    return result?.total ?? 0;
  }
}
