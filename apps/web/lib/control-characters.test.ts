import { expect, it } from "vitest";
import { hasIdentityControl, hasTextControl } from "./control-characters";
it("preserves every identity and portable-text control boundary", () => {
  for (let code = 0; code <= 159; code++) {
    const value = `before${String.fromCharCode(code)}after`;
    expect(hasIdentityControl(value)).toBe(code <= 31 || code === 127);
    expect(hasIdentityControl(value, true)).toBe(
      code <= 31 || (code >= 127 && code <= 159),
    );
    expect(hasTextControl(value)).toBe(
      code === 127 || (code <= 31 && ![9, 10, 13].includes(code)),
    );
  }
  for (const value of ["Visible λ 🧪", "", "Public-key-01"]) {
    expect(hasIdentityControl(value, true)).toBe(false);
    expect(hasTextControl(value)).toBe(false);
  }
});
