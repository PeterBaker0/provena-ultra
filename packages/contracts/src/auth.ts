import { z } from "zod";
import { statusSchema, userSchema } from "./common";

export const accessRequestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);
export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;

export const accessRequestSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  username: z.string(),
  requestedRoles: z.array(z.string()),
  reason: z.string().min(1),
  status: accessRequestStatusSchema,
  notes: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccessRequest = z.infer<typeof accessRequestSchema>;

export const accessRequestListSchema = z.object({
  requests: z.array(accessRequestSchema),
});
export type AccessRequestList = z.infer<typeof accessRequestListSchema>;

export const accessReportResponseSchema = z.object({
  status: statusSchema,
  reportMarkdown: z.string(),
});
export type AccessReportResponse = z.infer<typeof accessReportResponseSchema>;

export const groupSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  name: z.string(),
  description: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Group = z.infer<typeof groupSchema>;

export const listGroupsResponseSchema = z.object({
  status: statusSchema,
  groups: z.array(groupSchema),
});
export type ListGroupsResponse = z.infer<typeof listGroupsResponseSchema>;

export const describeGroupResponseSchema = z.object({
  status: statusSchema,
  group: groupSchema.nullable(),
});
export type DescribeGroupResponse = z.infer<typeof describeGroupResponseSchema>;

export const listMembersResponseSchema = z.object({
  status: statusSchema,
  groupName: z.string(),
  members: z.array(userSchema),
});
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;

export const listUserMembershipResponseSchema = z.object({
  status: statusSchema,
  username: z.string(),
  groups: z.array(groupSchema),
});
export type ListUserMembershipResponse = z.infer<
  typeof listUserMembershipResponseSchema
>;

export const userLinkSchema = z.object({
  username: z.string(),
  personId: z.string(),
  linkedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserLink = z.infer<typeof userLinkSchema>;

export const userLinkResponseSchema = z.object({
  status: statusSchema,
  link: userLinkSchema.nullable(),
});
export type UserLinkResponse = z.infer<typeof userLinkResponseSchema>;

