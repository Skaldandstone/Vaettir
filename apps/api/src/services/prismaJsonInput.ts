/** Prisma 5's recursive argument serializer assigns JSON keys into ordinary
 * objects. An own __proto__ key then changes that temporary object's prototype
 * instead of remaining JSON data. Its supported JSON-convertible input path
 * returns the reviewed JSON directly, preserving those keys at any depth.
 * Ordinary values and Prisma's explicit JSON-null sentinel stay unchanged. */
export function preservedPrismaJson(value: unknown): unknown {
  const pending = [value], seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, "__proto__")) return { toJSON: () => value };
    for (const property of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if ("value" in property) pending.push(property.value);
    }
  }
  return value;
}
