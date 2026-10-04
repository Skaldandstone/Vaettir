// SOURCE ONLY: authored, NOT RUN. No writes/migrations/acceptance tonight.
import { describe, it, expect } from "vitest";
import {
  savedCaseQueryCatalogFilters,
  savedCaseQueryCatalogInput,
  savedCaseQueryCatalogKey,
} from "./savedCaseQuerySchema.js";
import {
  savedQueryCatalogOrder,
  savedQueryCatalogCollection,
  savedQueryCatalogPaging,
} from "./savedCaseQueryCatalog.js";

describe("bounded saved catalog controls (NOT RUN)", () => {
  it("preserves absent legacy catalog/scope shape and old offset default", () => {
    expect(savedCaseQueryCatalogInput.parse({ projectId: "p" })).toEqual({
      projectId: "p",
      offset: 0,
    });
    expect(
      savedCaseQueryCatalogInput.parse({ projectId: "p", offset: 150 }),
    ).toEqual({ projectId: "p", offset: 150 });
  });
  it("retains literal whitespace/wildcards and keys exact filters without trimming", () => {
    const f = {
      search: " %_\\ ",
      collection: "ALL" as const,
      sort: "NAME_ASC" as const,
    };
    expect(savedCaseQueryCatalogFilters.parse(f)).toEqual(f);
    expect(savedCaseQueryCatalogKey(f)).toBe(
      JSON.stringify([" %_\\ ", "ALL", "NAME_ASC"]),
    );
    expect(savedCaseQueryCatalogKey({ ...f, search: "%_\\" })).not.toBe(
      savedCaseQueryCatalogKey(f),
    );
  });
  it("refuses unbounded offsets/search/unknown enums/SQL or other extra inputs", () => {
    const f = { search: "", collection: "ALL", sort: "NAME_ASC" };
    for (const bad of [
      { projectId: "p", offset: 151 },
      { projectId: "p", offset: 0.5 },
      { projectId: "p", catalog: { ...f, search: "x".repeat(81) } },
      { projectId: "p", catalog: { ...f, sort: "DROP TABLE" } },
      { projectId: "p", catalog: { ...f, collection: "FOREIGN" } },
      { projectId: "p", catalog: { ...f, sql: "q.id" } },
    ])
      expect(savedCaseQueryCatalogInput.safeParse(bad).success).toBe(false);
  });
  it("never proposes a next page exceeding the old schema cap", () => {
    expect(savedQueryCatalogPaging(0, true).nextOffset).toBe(50);
    expect(savedQueryCatalogPaging(100, true).nextOffset).toBe(150);
    expect(savedQueryCatalogPaging(150, true)).toMatchObject({
      nextOffset: null,
      catalogTruncated: true,
      pageSize: 50,
      maxOffset: 150,
    });
    expect(savedQueryCatalogPaging(150, false)).toMatchObject({
      nextOffset: null,
      catalogTruncated: false,
    });
  });
  it("sort fragments are fixed and collection actor values remain parameters", () => {
    expect(savedQueryCatalogOrder("UPDATED_DESC").text).toContain(
      'q."updatedAt" DESC, q.name ASC, q.id ASC',
    );
    expect(savedQueryCatalogOrder("NAME_DESC").text).toBe(
      "q.name DESC, q.id ASC",
    );
    const fragment = savedQueryCatalogCollection("MINE", "actor' OR TRUE --");
    expect(fragment.text).not.toContain("OR TRUE");
    expect(fragment.values).toEqual(["actor' OR TRUE --"]);
  });
});
