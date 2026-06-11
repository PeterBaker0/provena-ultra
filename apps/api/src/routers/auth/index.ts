/**
 * Auth API router group - mounted at /api/auth. Path layout matches the
 * legacy auth-api service (access control, groups, user-person link).
 */
import { Hono } from "hono";
import {
  requireUser,
  sysAdminGuards,
  type AuthenticatedUser,
  type AuthEnv,
} from "@provena/auth";
import {
  AUTHORISATION_COMPONENTS,
  authSchemas,
  registryRequestSchemas,
} from "@provena/interfaces";
import { submitJob } from "@provena/jobs";
import { getConfig } from "@provena/config";
import { buildAuthCheckAccessRouter } from "../checkAccess.js";
import { badRequest, unauthorized } from "../../errors.js";
import { failureStatus, successStatus } from "../../serializers.js";
import { getContainer } from "../../container.js";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const REQUEST_EXPIRY_DAYS = 30;

/* ------------------------------ access report ---------------------------- */

interface AccessReport {
  components: {
    component_name: string;
    component_roles: {
      role_name: string;
      role_display_name: string;
      role_level: string;
      description: string;
      intended_users: string[];
      access_granted: boolean;
    }[];
  }[];
}

const generateAccessReport = (user: AuthenticatedUser): AccessReport => ({
  components: AUTHORISATION_COMPONENTS.map((component) => ({
    component_name: component.component_name,
    component_roles: component.component_roles.map((role) => ({
      role_name: role.role_name,
      role_display_name: role.role_display_name,
      role_level: role.role_level,
      description: role.description,
      intended_users: role.intended_users,
      access_granted: user.roles.includes(role.role_name),
    })),
  })),
});

const reportDiff = (current: AccessReport, desired: AccessReport): AccessReport => {
  const currentMap = new Map<string, boolean>();
  for (const component of current.components) {
    for (const role of component.component_roles) {
      currentMap.set(`${component.component_name}:${role.role_name}`, role.access_granted);
    }
  }
  return {
    components: desired.components
      .map((component) => ({
        component_name: component.component_name,
        component_roles: component.component_roles.filter(
          (role) =>
            currentMap.get(`${component.component_name}:${role.role_name}`) !==
            role.access_granted,
        ),
      }))
      .filter((component) => component.component_roles.length > 0),
  };
};

/* --------------------------------- router -------------------------------- */

export const buildAuthRouter = (): Hono<AuthEnv> => {
  const router = new Hono<AuthEnv>();

  router.get("/", (c) => c.json({ message: "Health check successful." }));
  router.route("/check-access", buildAuthCheckAccessRouter());

  /* ------------------------- access control: user ----------------------- */

  router.get("/access-control/user/generate-access-report", requireUser(), (c) =>
    c.json({
      status: successStatus("Generated access report"),
      report: generateAccessReport(c.get("user")),
    }),
  );

  router.post("/access-control/user/request-change", requireUser(), async (c) => {
    const user = c.get("user");
    const desired = authSchemas.accessReportSchema.parse(await c.req.json());
    const sendEmailFlag = (c.req.query("send_email") ?? "true").toLowerCase() !== "false";
    const current = generateAccessReport(user);
    const diff = reportDiff(current, desired as AccessReport);
    if (diff.components.length === 0) {
      return c.json({
        status: failureStatus(
          "No differences found between current and requested access - no request lodged.",
        ),
      });
    }

    const { accessRequests } = getContainer();
    const requestId = nowSeconds();
    await accessRequests.create({
      username: user.username,
      request_id: requestId,
      email: user.email ?? user.username,
      expiry: nowSeconds() + REQUEST_EXPIRY_DAYS * 24 * 3600,
      created_timestamp: nowSeconds(),
      updated_timestamp: nowSeconds(),
      status: "PENDING_APPROVAL",
      ui_friendly_status: "request received, awaiting action",
      request_diff_contents: JSON.stringify(diff),
      complete_contents: JSON.stringify(desired),
      notes: "",
    });

    if (sendEmailFlag) {
      const config = getConfig();
      const diffText = diff.components
        .flatMap((component) =>
          component.component_roles.map(
            (role) =>
              `${component.component_name} / ${role.role_name}: ${role.access_granted ? "REQUESTED" : "REMOVAL REQUESTED"}`,
          ),
        )
        .join("\n");
      await submitJob({
        username: user.username,
        jobSubType: "SEND_EMAIL",
        payload: {
          email_to: config.ACCESS_REQUEST_EMAIL_ADDRESS,
          subject: `Provena access request from ${user.username} (id ${requestId})`,
          body: `User ${user.username} (${user.email ?? "no email"}) requested an access change:\n\n${diffText}\n\nRequest id: ${requestId}`,
          reason: "Access change request",
        },
      });
    }
    return c.json({ status: successStatus("Successfully lodged access change request.") });
  });

  router.get("/access-control/user/request-history", requireUser(), async (c) => {
    const { accessRequests } = getContainer();
    const items = await accessRequests.listForUser(c.get("user").username);
    return c.json({ items });
  });

  router.get("/access-control/user/pending-request-history", requireUser(), async (c) => {
    const { accessRequests } = getContainer();
    const items = await accessRequests.listForUser(c.get("user").username);
    return c.json({ items: items.filter((i) => i.status === "PENDING_APPROVAL") });
  });

  /* ------------------------- access control: admin ---------------------- */

  router.get(
    "/access-control/admin/all-pending-request-history",
    sysAdminGuards.read,
    async (c) => {
      const { accessRequests } = getContainer();
      const items = await accessRequests.listAll();
      return c.json({ items: items.filter((i) => i.status === "PENDING_APPROVAL") });
    },
  );

  router.get("/access-control/admin/all-request-history", sysAdminGuards.read, async (c) => {
    const { accessRequests } = getContainer();
    return c.json({ items: await accessRequests.listAll() });
  });

  router.get(
    "/access-control/admin/user-pending-request-history",
    sysAdminGuards.read,
    async (c) => {
      const username = c.req.query("username");
      if (!username) throw badRequest("Missing required query parameter 'username'.");
      const { accessRequests } = getContainer();
      const items = await accessRequests.listForUser(username);
      return c.json({ items: items.filter((i) => i.status === "PENDING_APPROVAL") });
    },
  );

  router.get("/access-control/admin/user-request-history", sysAdminGuards.read, async (c) => {
    const username = c.req.query("username");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { accessRequests } = getContainer();
    return c.json({ items: await accessRequests.listForUser(username) });
  });

  router.post("/access-control/admin/add-note", sysAdminGuards.write, async (c) => {
    const body = authSchemas.requestAddNoteSchema.parse(await c.req.json());
    const { accessRequests } = getContainer();
    const existing = await accessRequests.get(body.username, body.request_id);
    if (!existing) {
      throw badRequest(
        `No request found for username ${body.username} with id ${body.request_id}.`,
      );
    }
    const notes = existing.notes ? `${existing.notes},${body.note}` : body.note;
    await accessRequests.update(body.username, body.request_id, { notes });
    return c.json(successStatus("Note added successfully."));
  });

  router.post("/access-control/admin/change-request-state", sysAdminGuards.write, async (c) => {
    const body = authSchemas.accessRequestStatusChangeSchema.parse(await c.req.json());
    const sendEmailAlert =
      (c.req.query("send_email_alert") ?? "false").toLowerCase() === "true";
    const { accessRequests } = getContainer();
    const existing = await accessRequests.get(body.username, body.request_id);
    if (!existing) {
      throw badRequest(
        `No request found for username ${body.username} with id ${body.request_id}.`,
      );
    }
    const friendly: Record<string, string> = {
      PENDING_APPROVAL: "request received, awaiting action",
      APPROVED_PENDING_ACTION: "request approved, action underway",
      DENIED_PENDING_DELETION: "request denied",
      ACTIONED_PENDING_DELETION: "request approved and completed",
    };
    const notes = body.additional_note
      ? existing.notes
        ? `${existing.notes},${body.additional_note}`
        : body.additional_note
      : existing.notes;
    await accessRequests.update(body.username, body.request_id, {
      status: body.desired_state,
      ui_friendly_status: friendly[body.desired_state] ?? body.desired_state,
      notes,
    });

    let emailStatus = { success: true, details: "Email not requested." };
    if (sendEmailAlert) {
      try {
        await submitJob({
          username: c.get("user").username,
          jobSubType: "SEND_EMAIL",
          payload: {
            email_to: existing.email,
            subject: `Provena access request update (id ${body.request_id})`,
            body: `Your access request (id ${body.request_id}) status changed to: ${friendly[body.desired_state] ?? body.desired_state}.${body.additional_note ? `\n\nNote: ${body.additional_note}` : ""}`,
            reason: "Access request status change",
          },
        });
        emailStatus = { success: true, details: "Email alert lodged." };
      } catch (error) {
        emailStatus = { success: false, details: `Failed to send email: ${error}` };
      }
    }
    return c.json({
      state_change: successStatus("State changed successfully."),
      email_alert: emailStatus,
    });
  });

  router.post("/access-control/admin/delete-request", sysAdminGuards.admin, async (c) => {
    const body = authSchemas.deleteAccessRequestSchema.parse(await c.req.json());
    const { accessRequests } = getContainer();
    const removed = await accessRequests.remove(body.username, body.request_id);
    if (!removed) {
      throw badRequest(
        `No request found for username ${body.username} with id ${body.request_id}.`,
      );
    }
    return c.json(successStatus("Request deleted successfully."));
  });

  /* ----------------------------- groups: user --------------------------- */

  router.get("/groups/user/list_groups", requireUser(), async (c) => {
    const { groups } = getContainer();
    return c.json({
      status: successStatus("Successfully listed groups."),
      groups: await groups.listGroups(),
    });
  });

  router.get("/groups/user/describe_group", requireUser(), async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { groups } = getContainer();
    const group = await groups.getGroup(id);
    if (!group) throw badRequest(`Group with id ${id} does not exist.`);
    return c.json({ status: successStatus("Successfully described group."), group });
  });

  router.get("/groups/user/list_user_membership", requireUser(), async (c) => {
    const { groups } = getContainer();
    return c.json({
      status: successStatus("Successfully listed user membership."),
      groups: await groups.groupsForUser(c.get("user").username),
    });
  });

  router.get("/groups/user/list_members", requireUser(), async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { groups } = getContainer();
    const group = await groups.getGroup(id);
    if (!group) throw badRequest(`Group with id ${id} does not exist.`);
    /* Users can only list members of groups they belong to (legacy parity). */
    const isMember = await groups.isMember(id, c.get("user").username);
    if (!isMember) {
      throw unauthorized("You cannot list the members of a group you are not a member of.");
    }
    return c.json({
      status: successStatus("Successfully listed members."),
      group: { ...group, users: await groups.listMembers(id) },
    });
  });

  router.get("/groups/user/check_membership", requireUser(), async (c) => {
    const groupId = c.req.query("group_id");
    if (!groupId) throw badRequest("Missing required query parameter 'group_id'.");
    const { groups } = getContainer();
    const group = await groups.getGroup(groupId);
    if (!group) throw badRequest(`Group with id ${groupId} does not exist.`);
    return c.json({
      status: successStatus("Successfully checked membership."),
      is_member: await groups.isMember(groupId, c.get("user").username),
    });
  });

  /* ---------------------------- groups: admin --------------------------- */

  router.get("/groups/admin/list_groups", sysAdminGuards.read, async (c) => {
    const { groups } = getContainer();
    return c.json({
      status: successStatus("Successfully listed groups."),
      groups: await groups.listGroups(),
    });
  });

  router.get("/groups/admin/describe_group", sysAdminGuards.read, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { groups } = getContainer();
    const group = await groups.getGroup(id);
    if (!group) throw badRequest(`Group with id ${id} does not exist.`);
    return c.json({ status: successStatus("Successfully described group."), group });
  });

  router.get("/groups/admin/list_members", sysAdminGuards.read, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { groups } = getContainer();
    const group = await groups.getGroup(id);
    if (!group) throw badRequest(`Group with id ${id} does not exist.`);
    return c.json({
      status: successStatus("Successfully listed members."),
      group: { ...group, users: await groups.listMembers(id) },
    });
  });

  router.get("/groups/admin/list_user_membership", sysAdminGuards.read, async (c) => {
    const username = c.req.query("username");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { groups } = getContainer();
    return c.json({
      status: successStatus("Successfully listed user membership."),
      groups: await groups.groupsForUser(username),
    });
  });

  router.get("/groups/admin/check_membership", sysAdminGuards.read, async (c) => {
    const groupId = c.req.query("group_id");
    const username = c.req.query("username");
    if (!groupId) throw badRequest("Missing required query parameter 'group_id'.");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { groups } = getContainer();
    return c.json({
      status: successStatus("Successfully checked membership."),
      is_member: await groups.isMember(groupId, username),
    });
  });

  router.post("/groups/admin/add_member", sysAdminGuards.write, async (c) => {
    const groupId = c.req.query("group_id");
    if (!groupId) throw badRequest("Missing required query parameter 'group_id'.");
    const user = authSchemas.groupUserSchema.parse(await c.req.json());
    const { groups } = getContainer();
    const group = await groups.getGroup(groupId);
    if (!group) throw badRequest(`Group with id ${groupId} does not exist.`);
    await groups.addMember(groupId, user);
    return c.json({ status: successStatus("Successfully added member.") });
  });

  router.delete("/groups/admin/remove_member", sysAdminGuards.write, async (c) => {
    const groupId = c.req.query("group_id");
    const username = c.req.query("username");
    if (!groupId) throw badRequest("Missing required query parameter 'group_id'.");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { groups } = getContainer();
    const removed = await groups.removeMember(groupId, username);
    if (!removed) {
      throw badRequest(`User ${username} is not a member of group ${groupId}.`);
    }
    return c.json({ status: successStatus("Successfully removed member.") });
  });

  router.post("/groups/admin/remove_members", sysAdminGuards.write, async (c) => {
    const body = authSchemas.removeMembersRequestSchema.parse(await c.req.json());
    const { groups } = getContainer();
    for (const username of body.member_usernames) {
      await groups.removeMember(body.group_id, username);
    }
    return c.json({ status: successStatus("Successfully removed members.") });
  });

  router.post("/groups/admin/add_group", sysAdminGuards.write, async (c) => {
    const group = authSchemas.userGroupMetadataSchema.parse(await c.req.json());
    const { groups } = getContainer();
    if (await groups.getGroup(group.id)) {
      throw badRequest(`Group with id ${group.id} already exists.`);
    }
    await groups.putGroup(group);
    return c.json({ status: successStatus("Successfully added group.") });
  });

  router.delete("/groups/admin/remove_group", sysAdminGuards.write, async (c) => {
    const id = c.req.query("id");
    if (!id) throw badRequest("Missing required query parameter 'id'.");
    const { groups } = getContainer();
    const removed = await groups.removeGroup(id);
    if (!removed) throw badRequest(`Group with id ${id} does not exist.`);
    return c.json({ status: successStatus("Successfully removed group.") });
  });

  router.put("/groups/admin/update_group", sysAdminGuards.write, async (c) => {
    const group = authSchemas.userGroupMetadataSchema.parse(await c.req.json());
    const { groups } = getContainer();
    if (!(await groups.getGroup(group.id))) {
      throw badRequest(`Group with id ${group.id} does not exist.`);
    }
    await groups.putGroup(group);
    return c.json({ status: successStatus("Successfully updated group.") });
  });

  /* ----------------------- groups import/export ------------------------- */

  router.get("/groups/admin/export", sysAdminGuards.admin, async (c) => {
    const { groups } = getContainer();
    const allGroups = await groups.listGroups();
    const exported = [];
    for (const group of allGroups) {
      exported.push({ ...group, users: await groups.listMembers(group.id) });
    }
    return c.json({
      status: successStatus(`Successfully exported ${exported.length} groups.`),
      items: exported,
    });
  });

  router.post("/groups/admin/import", sysAdminGuards.admin, async (c) => {
    const body = authSchemas.groupsImportRequestSchema.parse(await c.req.json());
    const { groups } = getContainer();
    const existing = new Set((await groups.listGroups()).map((g) => g.id));
    const oldSize = existing.size;

    const parsedGroups = [];
    const failures: [string, Record<string, unknown>][] = [];
    for (const raw of body.items) {
      const result = authSchemas.userGroupSchema.safeParse(raw);
      if (result.success) {
        parsedGroups.push(result.data);
      } else {
        failures.push([`Failed to parse group: ${result.error.message}`, raw]);
      }
    }
    if (body.parse_items && failures.length > 0) {
      return c.json({
        status: failureStatus(`Failed to parse ${failures.length} groups - aborting.`),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: failures,
      });
    }

    const incoming = new Set(parsedGroups.map((g) => g.id));
    const newEntries = parsedGroups.filter((g) => !existing.has(g.id));
    const overwritten = parsedGroups.filter((g) => existing.has(g.id));
    const unmatched = [...existing].filter((id) => !incoming.has(id));
    const deleting = body.import_mode === "SYNC_DELETION_ALLOWED" ? unmatched : [];
    if (deleting.length > 0 && !body.allow_entry_deletion) {
      return c.json({
        status: failureStatus(
          `Import would delete ${deleting.length} groups but allow_entry_deletion is false.`,
        ),
        trial_mode: body.trial_mode,
        statistics: null,
        failure_list: null,
      });
    }

    if (!body.trial_mode) {
      for (const group of parsedGroups) {
        await groups.putGroup(group);
        await groups.replaceMembers(group.id, group.users);
      }
      for (const id of deleting) await groups.removeGroup(id);
    }

    return c.json({
      status: successStatus(body.trial_mode ? "Trial import successful." : "Import successful."),
      trial_mode: body.trial_mode,
      statistics: {
        old_size: oldSize,
        new_size: oldSize + newEntries.length - deleting.length,
        deleted_entries: deleting.length,
        overwritten_entries: overwritten.length,
        new_entries: newEntries.length,
      },
      failure_list: failures.length > 0 ? failures : null,
    });
  });

  router.post("/groups/admin/restore_from_table", sysAdminGuards.admin, async () => {
    throw badRequest(
      "restore_from_table is a DynamoDB-specific operation which is not supported in Provena v2. Use the /groups/admin/import endpoint instead.",
    );
  });

  /* ------------------------------ link: user ---------------------------- */

  router.get("/link/user/lookup", requireUser(), async (c) => {
    const username = c.req.query("username") ?? c.get("user").username;
    const { links } = getContainer();
    const personId = await links.lookup(username);
    return c.json({ person_id: personId, success: personId !== null });
  });

  const validatePersonLink = async (
    personId: string,
    user: AuthenticatedUser,
  ): Promise<{ valid: boolean; details: string }> => {
    const { items } = getContainer();
    const stored = await items.fetchItem(personId);
    if (!stored) {
      return { valid: false, details: `Person with id ${personId} does not exist.` };
    }
    if (stored.base.itemSubType !== "PERSON") {
      return {
        valid: false,
        details: `Item ${personId} has subtype ${stored.base.itemSubType}, expected PERSON.`,
      };
    }
    if (stored.base.recordType !== "COMPLETE_ITEM") {
      return { valid: false, details: `Person ${personId} is an incomplete seed item.` };
    }
    void user;
    return { valid: true, details: "Valid person." };
  };

  router.post("/link/user/validate", requireUser(), async (c) => {
    const body = authSchemas.userLinkUserValidateRequestSchema.parse(await c.req.json());
    const result = await validatePersonLink(body.person_id, c.get("user"));
    return c.json({
      status: result.valid ? successStatus(result.details) : failureStatus(result.details),
    });
  });

  router.post("/link/user/assign", requireUser(), async (c) => {
    const body = authSchemas.userLinkUserAssignRequestSchema.parse(await c.req.json());
    const user = c.get("user");
    const { links } = getContainer();
    const existing = await links.lookup(user.username);
    if (existing) {
      throw badRequest(
        `Username ${user.username} already has a linked person (${existing}). Contact an admin to update the link.`,
      );
    }
    const validation = await validatePersonLink(body.person_id, user);
    if (!validation.valid) throw badRequest(validation.details);
    await links.assign(user.username, body.person_id);
    return c.json({});
  });

  /* ----------------------------- link: admin ---------------------------- */

  router.get("/link/admin/lookup", sysAdminGuards.read, async (c) => {
    const username = c.req.query("username");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { links } = getContainer();
    const personId = await links.lookup(username);
    return c.json({ person_id: personId, success: personId !== null });
  });

  router.post("/link/admin/assign", sysAdminGuards.write, async (c) => {
    const body = authSchemas.adminLinkUserAssignRequestSchema.parse(await c.req.json());
    const { links } = getContainer();
    const existing = await links.lookup(body.username);
    if (existing && !body.force) {
      throw badRequest(
        `Username ${body.username} already has a linked person (${existing}). Use force to overwrite.`,
      );
    }
    if (body.validate_item) {
      const validation = await validatePersonLink(body.person_id, c.get("user"));
      if (!validation.valid) throw badRequest(validation.details);
    }
    await links.assign(body.username, body.person_id);
    return c.json({});
  });

  router.delete("/link/admin/clear", sysAdminGuards.admin, async (c) => {
    const username = c.req.query("username");
    if (!username) throw badRequest("Missing required query parameter 'username'.");
    const { links } = getContainer();
    await links.clear(username);
    return c.json({});
  });

  router.get("/link/admin/reverse_lookup", sysAdminGuards.read, async (c) => {
    const personId = c.req.query("person_id");
    if (!personId) throw badRequest("Missing required query parameter 'person_id'.");
    const { links } = getContainer();
    return c.json({ usernames: await links.reverseLookup(personId) });
  });

  return router;
};
