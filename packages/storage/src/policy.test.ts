import { describe, expect, it } from "vitest";
import { createPolicyDocument, generateReadWritePaths } from "./policy.js";

const location = { bucket_name: "provena-datasets", path: "datasets/10378-1-123/" };

describe("policy generation", () => {
  it("scopes read paths to the dataset prefix with bucket-wide list", () => {
    const paths = generateReadWritePaths(location, false);
    expect(paths.readUris).toEqual([
      "arn:aws:s3:::provena-datasets/datasets/10378-1-123",
      "arn:aws:s3:::provena-datasets/datasets/10378-1-123/",
      "arn:aws:s3:::provena-datasets/datasets/10378-1-123/*",
    ]);
    expect(paths.writeUris).toEqual([]);
    expect(paths.listUris).toEqual([
      "arn:aws:s3:::provena-datasets",
      "arn:aws:s3:::provena-datasets/*",
    ]);
  });

  it("write mode adds write resources", () => {
    const paths = generateReadWritePaths(location, true);
    expect(paths.writeUris).toHaveLength(3);
  });

  it("produces a valid policy document without action wildcards", () => {
    const document = JSON.parse(
      createPolicyDocument(generateReadWritePaths(location, true)),
    ) as {
      Version: string;
      Statement: { Action: string[]; Effect: string; Resource: string[] }[];
    };
    expect(document.Version).toBe("2012-10-17");
    expect(document.Statement).toHaveLength(3);
    const allActions = document.Statement.flatMap((s) => s.Action);
    /* RustFS rejects action wildcards - ensure fully expanded actions. */
    expect(allActions.every((a) => !a.includes("*"))).toBe(true);
    expect(allActions).toContain("s3:PutObject");
    expect(allActions).toContain("s3:GetObject");
    expect(allActions).toContain("s3:ListBucket");
  });

  it("read-only policy omits write statement", () => {
    const document = JSON.parse(
      createPolicyDocument(generateReadWritePaths(location, false)),
    ) as { Statement: { Action: string[] }[] };
    expect(document.Statement).toHaveLength(2);
    expect(document.Statement.flatMap((s) => s.Action)).not.toContain("s3:PutObject");
  });
});
