/** Literal control checks without regex character-range ambiguity. */
export function hasIdentityControl(value: string, includeC1 = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return (
      code <= 31 || code === 127 || (includeC1 && code >= 128 && code <= 159)
    );
  });
}
export function hasTextControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return (
      code === 127 || (code <= 31 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}
