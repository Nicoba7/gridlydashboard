import type { CanonicalDeviceShadowState } from "./deviceShadow";

export interface DeviceShadowStore {
  getDeviceState(deviceId: string): CanonicalDeviceShadowState | undefined;
  setDeviceState(deviceId: string, state: CanonicalDeviceShadowState): void;
  getAllDeviceStates(): Record<string, CanonicalDeviceShadowState>;
}

export class InMemoryDeviceShadowStore implements DeviceShadowStore {
  private readonly states = new Map<string, CanonicalDeviceShadowState>();

  getDeviceState(deviceId: string): CanonicalDeviceShadowState | undefined {
    const current = this.states.get(deviceId);
    return current ? { ...current } : undefined;
  }

  setDeviceState(deviceId: string, state: CanonicalDeviceShadowState): void {
    this.states.set(deviceId, { ...state });
  }

  getAllDeviceStates(): Record<string, CanonicalDeviceShadowState> {
    return [...this.states.entries()].reduce<Record<string, CanonicalDeviceShadowState>>((acc, [deviceId, state]) => {
      acc[deviceId] = { ...state };
      return acc;
    }, {});
  }
}
