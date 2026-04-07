import { z } from "zod";
import { LineageNodeSchema } from "./common";

export const LineageEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.string(),
});

export const LineageResponseSchema = z.object({
  nodes: z.array(LineageNodeSchema),
  edges: z.array(LineageEdgeSchema),
});

export const GenerateReportResponseSchema = z.object({
  job_id: z.string().optional(),
  report_url: z.string().nullable().optional(),
  status: z.string(),
});

export type LineageResponse = z.infer<typeof LineageResponseSchema>;
export type GenerateReportResponse = z.infer<typeof GenerateReportResponseSchema>;
