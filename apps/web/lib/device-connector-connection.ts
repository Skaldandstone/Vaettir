export type DeviceConnectionGeneration = { epoch: number; active: boolean; blocked: boolean; controllers: Set<AbortController> };
export function createDeviceConnectionGeneration(): DeviceConnectionGeneration { return { epoch: 0, active: true, blocked: false, controllers: new Set() }; }
export function revokeDeviceConnection(value: DeviceConnectionGeneration, options: { blocked?: boolean; active?: boolean } = {}): number {
  value.epoch++;
  if (options.blocked !== undefined) value.blocked = options.blocked;
  if (options.active !== undefined) value.active = options.active;
  for (const controller of value.controllers) controller.abort();
  value.controllers.clear();
  return value.epoch;
}
export function beginDeviceConnection(value: DeviceConnectionGeneration): number | null {
  return value.active ? revokeDeviceConnection(value, { blocked: false }) : null;
}
export function currentDeviceConnection(value: DeviceConnectionGeneration, epoch: number): boolean { return value.active && !value.blocked && value.epoch === epoch; }
export function registerDeviceConnectionRequest(value: DeviceConnectionGeneration, epoch: number, controller: AbortController): () => void {
  if (!currentDeviceConnection(value, epoch)) { controller.abort(); throw new DOMException("Connection attempt is no longer current.", "AbortError"); }
  value.controllers.add(controller);
  return () => value.controllers.delete(controller);
}
