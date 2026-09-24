import { describe, expect, it } from "vitest";
import { mapCsvRows } from "./csvFieldMapping.js";

const CSV = `Id,Title,Preconditions,Steps,Expected,Priority,Tags
TC-1,Login succeeds,Account exists,Open login|Choose OAuth,Dashboard opens,High,auth|smoke
TC-2,,Guest session,Open pricing,Plans are shown,Medium,billing
`;

const MAPPING = {
  externalId: "Id",
  title: "Title",
  given: "Preconditions",
  when: "Steps",
  then: "Expected",
  priority: "Priority",
  tags: "Tags",
};

describe("mapped CSV row repair", () => {
  it("retains incomplete source rows with their mapped fields", () => {
    const result = mapCsvRows(CSV, MAPPING);

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ rowNumber: 3, reason: "missing title" }]);
    expect(result.incompleteRows).toEqual([
      {
        rowNumber: 3,
        title: "",
        given: ["Guest session"],
        when: ["Open pricing"],
        then: ["Plans are shown"],
        priority: "MEDIUM",
        tags: ["billing"],
        externalId: "TC-2",
      },
    ]);
  });

  it("applies reviewed row edits instead of dropping the source row", () => {
    const result = mapCsvRows(CSV, MAPPING, undefined, [
      {
        rowNumber: 3,
        title: "Pricing is visible to guests",
        when: ["Open the pricing page", "Review available plans"],
      },
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.incompleteRows).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({
      rowNumber: 3,
      title: "Pricing is visible to guests",
      given: ["Guest session"],
      when: ["Open the pricing page", "Review available plans"],
      then: ["Plans are shown"],
      externalId: "TC-2",
    });
  });
});
