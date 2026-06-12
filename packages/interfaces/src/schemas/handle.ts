/**
 * Zod schemas for the handle (id service) API, ported from legacy
 * `ProvenaInterfaces/HandleAPI.py` / `HandleModels.py`.
 */
import { z } from "zod";
import { nonEmptyString } from "./common.js";

export const valueTypeSchema = z.enum(["DESC", "URL"]);

export const mintRequestSchema = z.object({
  value_type: valueTypeSchema,
  value: nonEmptyString,
});

export const addValueRequestSchema = z.object({
  value_type: valueTypeSchema,
  value: nonEmptyString,
  id: nonEmptyString,
});

export const addValueIndexRequestSchema = z.object({
  value_type: valueTypeSchema,
  value: nonEmptyString,
  id: nonEmptyString,
  index: z.number().int(),
});

export const modifyRequestSchema = z.object({
  id: nonEmptyString,
  index: z.number().int(),
  value: nonEmptyString,
});

export const removeRequestSchema = z.object({
  id: nonEmptyString,
  index: z.number().int(),
});
