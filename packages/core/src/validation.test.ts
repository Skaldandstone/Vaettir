import { describe, expect, it } from "vitest";
import { z as native } from "zod";
import { z } from "./validation.js";
import { readFileSync } from "node:fs";
import ts from "typescript";

describe("patched parser with existing application text contracts", () => {
  it("keeps the shared validation leaf browser-pure", () => {
    const source = readFileSync(new URL("./validation.ts", import.meta.url), "utf8");
    const ast = ts.createSourceFile("validation.ts", source, ts.ScriptTarget.Latest, true);
    expect(ast.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text)).toEqual(["zod"]);
    expect(source).not.toMatch(/node:|@vaettir\/db|\brequire\s*\(|\bimport\s*\(|\bprocess\.|\bglobalThis\./);
  });
  it("retains UTF-16 min/max/exact limits without changing the input", () => {
    expect(z.string().max(2).parse("😀")).toBe("😀");
    expect(z.string().max(1).safeParse("😀").success).toBe(false);
    expect(z.string().min(2).parse("😀")).toBe("😀");
    expect(z.string().length(2).parse("😀")).toBe("😀");
    expect(z.string().length(1).safeParse("😀").success).toBe(false);
    expect(z.string().min(3).safeParse("😀").success).toBe(false);
    expect(z.string().max(2).safeParse("abc").success).toBe(false);
    expect(z.string().max(2).parse("\ud800")).toBe("\ud800");
  });
  it("retains checks through ordinary string chains and wrappers", () => {
    const value = z.string().trim().regex(/^😀/u).refine(v => v !== "no").max(2).nullable().optional();
    expect(value.parse(" 😀 ")).toBe("😀");
    expect(value.parse(null)).toBeNull();
    expect(value.parse(undefined)).toBeUndefined();
    expect(value.safeParse("😀x").success).toBe(false);
    expect(z.string().max(2).transform(v => v + "!").parse("😀")).toBe("😀!");
  });
  it("retains native constraint metadata, custom messages and async parsing", async () => {
    const value = z.string().min(2).max(4, "Existing width limit");
    expect(value.minLength).toBe(2);
    expect(value.maxLength).toBe(4);
    const result = value.safeParse("😀😀x");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big", maximum: 4, message: "Existing width limit" }]);
    await expect(value.parseAsync("😀")).resolves.toBe("😀");
    // The adapter owns only its new checks, never shared Zod behavior.
    expect(native.string().max(1).parse("😀")).toBe("😀");
  });
  it("keeps the native oversized-array short circuit before invalid elements", () => {
    const value = new Array(4096).fill(1);
    let reads = 0;
    Object.defineProperty(value, "0", { get() { reads++; return 1; } });
    const result = z.array(z.string()).max(200).safeParse(value);
    expect(reads).toBe(0);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big", origin: "array", maximum: 200 }]);
  });
  it("keeps existing string-key records and explicit partial enum mappings", () => {
    expect(z.record(z.string().max(2)).parse({ case_a: "😀" })).toEqual({ case_a: "😀" });
    expect(z.record(z.string().max(1)).safeParse({ case_a: "😀" }).success).toBe(false);
    const mapping = z.partialRecord(z.enum(["title", "priority"]), z.string());
    expect(mapping.parse({ title: "Name" })).toEqual({ title: "Name" });
    expect(mapping.safeParse({ other: "Name" }).success).toBe(false);
  });
});
