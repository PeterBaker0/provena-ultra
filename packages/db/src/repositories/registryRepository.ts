import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import type { DbClient } from "../client";
import { registryAccessGroupRoles, registryAccessSettings, registryItemHistory, registryItems } from "../schema";

export interface RegistryListFilter {
  category?: string;
  subtype?: string;
  filter?: string;
  limit: number;
  offset: number;
}

export class RegistryRepository {
  constructor(private readonly db: DbClient) {}

  private buildWhere(filter: RegistryListFilter) {
    const whereClauses = [
      filter.category ? eq(registryItems.category, filter.category as "activity" | "entity" | "agent") : undefined,
      filter.subtype
        ? eq(
            registryItems.subtype,
            filter.subtype as
              | "person"
              | "organisation"
              | "dataset"
              | "model"
              | "study"
              | "create"
              | "version"
              | "model_run"
              | "model_run_workflow_template"
              | "dataset_template",
          )
        : undefined,
      filter.filter ? ilike(registryItems.displayName, `%${filter.filter}%`) : undefined,
    ].filter(Boolean);

    if (whereClauses.length === 0) {
      return undefined;
    }
    if (whereClauses.length === 1) {
      return whereClauses[0];
    }
    return and(...(whereClauses as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]));
  }

  public async fetchById(id: string): Promise<(typeof registryItems.$inferSelect) | null> {
    const [item] = await this.db
      .select()
      .from(registryItems)
      .where(eq(registryItems.id, id))
      .limit(1);
    return item ?? null;
  }

  public async list(
    filter: RegistryListFilter,
  ): Promise<{ total: number; records: (typeof registryItems.$inferSelect)[] }> {
    const whereExpr = this.buildWhere(filter);

    const countRows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(registryItems)
      .where(whereExpr);
    const total = countRows[0]?.value ?? 0;

    const records = await this.db
      .select()
      .from(registryItems)
      .where(whereExpr)
      .orderBy(desc(registryItems.updatedAt), asc(registryItems.id))
      .limit(filter.limit)
      .offset(filter.offset);

    return {
      total,
      records,
    };
  }

  public async create(input: {
    id: string;
    category: string;
    subtype: string;
    displayName: string;
    ownerUsername: string;
    record: Record<string, unknown>;
  }): Promise<typeof registryItems.$inferSelect> {
    const [created] = await this.db
      .insert(registryItems)
      .values({
        id: input.id,
        category: input.category as "activity" | "entity" | "agent",
        subtype: input.subtype as
          | "person"
          | "organisation"
          | "dataset"
          | "model"
          | "study"
          | "create"
          | "version"
          | "model_run"
          | "model_run_workflow_template"
          | "dataset_template",
        version: 0,
        displayName: input.displayName,
        ownerUsername: input.ownerUsername,
        record: input.record,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create registry item.");
    }

    await this.db.insert(registryAccessSettings).values({
      itemId: created.id,
      openAccess: false,
    });

    return created;
  }

  public async update(input: {
    id: string;
    record: Record<string, unknown>;
    displayName?: string;
    updatedBy: string;
  }): Promise<typeof registryItems.$inferSelect> {
    const existing = await this.fetchById(input.id);
    if (!existing) {
      throw new Error(`Registry item ${input.id} was not found.`);
    }

    await this.db.insert(registryItemHistory).values({
      itemId: existing.id,
      version: existing.version,
      record: existing.record,
      changedBy: input.updatedBy,
    });

    const [updated] = await this.db
      .update(registryItems)
      .set({
        record: input.record,
        displayName: input.displayName ?? existing.displayName,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(registryItems.id, input.id))
      .returning();

    if (!updated) {
      throw new Error(`Registry item ${input.id} failed to update.`);
    }

    return updated;
  }

  public async setAccessRoles(input: {
    itemId: string;
    openAccess: boolean;
    groupRoles: { groupName: string; role: string }[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(registryAccessSettings)
        .set({
          openAccess: input.openAccess,
          updatedAt: new Date(),
        })
        .where(eq(registryAccessSettings.itemId, input.itemId));

      await tx
        .delete(registryAccessGroupRoles)
        .where(eq(registryAccessGroupRoles.itemId, input.itemId));

      if (input.groupRoles.length > 0) {
        await tx.insert(registryAccessGroupRoles).values(
          input.groupRoles.map((entry) => ({
            itemId: input.itemId,
            groupName: entry.groupName,
            role: entry.role,
          })),
        );
      }
    });
  }

  public async getAccessRoles(itemId: string): Promise<{
    openAccess: boolean;
    groupRoles: { groupName: string; role: string }[];
  }> {
    const [settings] = await this.db
      .select()
      .from(registryAccessSettings)
      .where(eq(registryAccessSettings.itemId, itemId))
      .limit(1);

    if (!settings) {
      return {
        openAccess: false,
        groupRoles: [],
      };
    }

    const roles = await this.db
      .select({
        groupName: registryAccessGroupRoles.groupName,
        role: registryAccessGroupRoles.role,
      })
      .from(registryAccessGroupRoles)
      .where(eq(registryAccessGroupRoles.itemId, itemId))
      .orderBy(asc(registryAccessGroupRoles.groupName));

    return {
      openAccess: settings?.openAccess ?? false,
      groupRoles: roles,
    };
  }
}
