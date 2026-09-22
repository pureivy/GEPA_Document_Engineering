import { describe, expect, it } from "vitest";
import { HWPX_FAMILIES } from "../../lib/hwpx/families";
import { FamilySchema } from "../../lib/docmodel/schema";

describe("HWPX_FAMILIES", () => {
  it("has a writer for every family in the schema", () => {
    expect(Object.keys(HWPX_FAMILIES).sort()).toEqual([...FamilySchema.options].sort());
  });
});
