import { describe, expect, it } from "vitest";
import { decodePaginationKey, encodePaginationKey } from "./items.js";

describe("pagination cursors", () => {
  it("round-trips cursor values through the opaque wire shape", () => {
    const cursor = { s: "Display Name", id: "10378.1/123" };
    const key = encodePaginationKey(cursor);
    expect(typeof key.pk).toBe("string");
    expect(decodePaginationKey(key)).toEqual(cursor);
  });

  it("round-trips numeric sort values", () => {
    const cursor = { s: 1700000000, id: "10378.1/9" };
    expect(decodePaginationKey(encodePaginationKey(cursor))).toEqual(cursor);
  });

  it("returns null for malformed keys", () => {
    expect(decodePaginationKey(null)).toBeNull();
    expect(decodePaginationKey({})).toBeNull();
    expect(decodePaginationKey({ pk: "not-base64-json!!" })).toBeNull();
    expect(decodePaginationKey({ pk: 42 } as never)).toBeNull();
  });
});
