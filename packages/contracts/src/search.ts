import { z } from "zod";

export const QueryResultSchema = z.object({
  id: z.string(),
  score: z.number(),
});

export const QueryResultsSchema = z.object({
  status: z.boolean().default(true),
  results: z.array(QueryResultSchema),
});

export type QueryResult = z.infer<typeof QueryResultSchema>;
export type QueryResults = z.infer<typeof QueryResultsSchema>;
