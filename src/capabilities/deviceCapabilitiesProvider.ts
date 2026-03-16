import type { DeviceCapabilities } from "./deviceCapabilities";

/**
 * Capabilities lookup seam for execution preflight.
 * See docs/architecture/execution-architecture.md for orchestration boundaries.
 */
export interface DeviceCapabilitiesProvider {
  getCapabilities(deviceId: string): DeviceCapabilities | undefined;
}

export class InMemoryDeviceCapabilitiesProvider implements DeviceCapabilitiesProvider {
  private readonly byDeviceId: Map<string, DeviceCapabilities>;

  constructor(capabilities: DeviceCapabilities[]) {
    this.byDeviceId = new Map(capabilities.map((item) => [item.deviceId, item]));
  }

  getCapabilities(deviceId: string): DeviceCapabilities | undefined {
    return this.byDeviceId.get(deviceId);
  }
}
