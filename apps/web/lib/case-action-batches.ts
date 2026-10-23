/** Free case-management actions only. Paid analysis has its own reviewed job flow. */
export async function runCaseActionBatches<T>(
  selectedIds: readonly string[],
  execute: (ids: string[]) => Promise<T>,
) {
  const ids = [...new Set(selectedIds)];
  const results: T[] = [];
  let completed = 0;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    try {
      results.push(await execute(batch));
      completed += batch.length;
    } catch (error) {
      // Never replay an ambiguous failed write automatically. Retain that batch
      // and all unattempted IDs for an explicit user retry; earlier success stays.
      return { results, completedIds: ids.slice(0, completed), remainingIds: ids.slice(completed), error };
    }
  }
  return { results, completedIds: ids, remainingIds: [] as string[], error: null };
}
