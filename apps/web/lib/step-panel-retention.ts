/** Page-local state, not native permission or persisted execution evidence. */
export class StepPanelRetention {
  private readonly visited = new Set<number>();
  private readonly pending = new Set<number>();
  visit(index: number, count: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= count || !Number.isSafeInteger(count) || count < 1 || count > 1000) return false;
    this.visited.add(index);
    return true;
  }
  indexes() { return [...this.visited].sort((a, b) => a - b); }
  has(index: number) { return this.visited.has(index); }
  /** One step's ACK cannot release a different step's uncertain request. */
  markPending(index: number, value: boolean) {
    if (!this.visited.has(index)) return this.pending.size > 0;
    if (value) this.pending.add(index); else this.pending.delete(index);
    return this.pending.size > 0;
  }
}
