import { createHash } from "node:crypto";
import { describe,expect,it } from "vitest";
import { readRepositoryRequirementsDocument,verifiedRequirementsDocumentBytes } from "./repository-requirements-document";
const markdown="# Requirements draft\n\nINFERRED FROM CODE; unconfirmed.\n";
const value={fileName:"requirements.md",classification:"INFERRED_FROM_CODE",confirmed:false,headSha:"a".repeat(40),markdown,contentHash:createHash("sha256").update(markdown).digest("hex")};
describe("saved requirements artifact, not provider/browser acceptance",()=>{
  it("reads the exact unconfirmed bounded artifact and verifies retained byte checksum",async()=>{
    const doc=readRepositoryRequirementsDocument({requirementsDocument:value})!;
    expect(doc).toEqual(value);expect(new TextDecoder().decode(await verifiedRequirementsDocumentBytes(doc))).toBe(markdown);
  });
  it.each([{confirmed:true},{fileName:"../requirements.md"},{classification:"APPROVED"},{headSha:"HEAD"},{contentHash:"wrong"},{markdown:"x".repeat(524289)}])("refuses unsupported artifact metadata or oversized content %j",change=>{
    expect(readRepositoryRequirementsDocument({requirementsDocument:{...value,...change}})).toBeNull();
  });
  it("does not download altered retained bytes",async()=>{
    const doc=readRepositoryRequirementsDocument({requirementsDocument:{...value,markdown:markdown+"changed"}})!;
    await expect(verifiedRequirementsDocumentBytes(doc)).rejects.toThrow("checksum did not match");
  });
});
