// Test fixture keys stay distinct across a suite's tenants, including moves.
// Production allocation and legacy aliases have separate native tests.
let nextKey = 0;
export function fixtureProjectKey(): string {
  if (nextKey >= 26 ** 4) throw new Error("Synthetic project key space exhausted");
  let value = nextKey++, suffix = "";
  for (let index = 0; index < 4; index++) {
    suffix = String.fromCharCode(97 + value % 26) + suffix;
    value = Math.floor(value / 26);
  }
  return "z" + suffix;
}
