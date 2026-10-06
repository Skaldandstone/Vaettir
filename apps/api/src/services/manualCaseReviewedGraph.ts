import { TRPCError } from "@trpc/server";
import { z } from "zod";
/** Complete frozen graph, not merely the selected transitive closure. */
export function admitWholeCaseFrozenGraph(
  ids: readonly string[],
  raw: unknown,
): Record<string, string[]> {
  const invalid = (): never => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete frozen prerequisite graph is unsupported. No partial graph was reviewed.",
    });
  };
  const parsed = z
    .record(z.array(z.string().min(1).max(200)).max(1000))
    .safeParse(raw);
  if (
    !parsed.success ||
    ids.length < 1 ||
    ids.length > 1000 ||
    new Set(ids).size !== ids.length
  )
    return invalid();
  const graph = parsed.data,
    scope = new Set(ids),
    keys = Object.keys(graph);
  if (
    keys.length !== ids.length ||
    keys.some((key) => !scope.has(key)) ||
    Object.values(graph).reduce((n, list) => n + list.length, 0) > 10000
  )
    return invalid();
  for (const [key, list] of Object.entries(graph))
    if (
      new Set(list).size !== list.length ||
      list.some((id) => id === key || !scope.has(id))
    )
      return invalid();
  const visiting = new Set<string>(),
    done = new Set<string>();
  for (const root of ids) {
    if (done.has(root)) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    visiting.add(root);
    while (stack.length) {
      const node = stack.at(-1)!,
        list = graph[node.id]!;
      if (node.next === list.length) {
        visiting.delete(node.id);
        done.add(node.id);
        stack.pop();
        continue;
      }
      const child = list[node.next++]!;
      if (visiting.has(child)) return invalid();
      if (!done.has(child)) {
        visiting.add(child);
        stack.push({ id: child, next: 0 });
      }
    }
  }
  return graph;
}
