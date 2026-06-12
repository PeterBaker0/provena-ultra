import { z } from "zod";

/** Non-empty string (pydantic `min_anystr_length = 1`). */
export const nonEmptyString = z.string().min(1);

/** http(s) URL (pydantic AnyHttpUrl). */
export const httpUrl = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        const url = new URL(v);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid http(s) URL" },
  );

/** Any URI with a scheme (pydantic helpers.types.AnyUri). */
export const anyUri = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/.+$/, "Must be a valid URI including a scheme");

/** ISO date string YYYY-MM-DD (pydantic `date`). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD)")
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Must be a valid date" });

/** Unix timestamp in seconds. */
export const unixTimestamp = z.number().int();

/** Free-form key/value annotations. */
export const userMetadata = z.record(z.string());

export const statusSchema = z.object({
  success: z.boolean(),
  details: z.string(),
});

export const importModeSchema = z.enum([
  "ADD_ONLY",
  "ADD_OR_OVERWRITE",
  "OVERWRITE_ONLY",
  "SYNC_ADD_OR_OVERWRITE",
  "SYNC_DELETION_ALLOWED",
]);

/**
 * ISO8601 duration e.g. P1Y2M10DT2H30M (legacy used isodate.parse_duration).
 */
export const iso8601Duration = z
  .string()
  .regex(
    /^P(?!$)(\d+(\.\d+)?Y)?(\d+(\.\d+)?M)?(\d+(\.\d+)?W)?(\d+(\.\d+)?D)?(T(?=\d)(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/,
    "Invalid temporal resolution. The value must conform to the ISO8601 Time Duration format (e.g.'P1Y2M10DT2H30M').",
  );

/** Opaque pagination key dict (legacy DynamoDB-style passthrough). */
export const paginationKeySchema = z.record(z.unknown());

export type PaginationKey = z.infer<typeof paginationKeySchema>;
