import type { CanonicalDeviceCommandKind } from "../application/controlLoopExecution/canonicalCommand";

/**
 * Canonical planning/execution capability contract used by Gridly core.
 *
 * This is a vendor-neutral model and not a provider-specific payload.
 */
export interface DeviceCapabilities {
  deviceId: string;
  supportedCommandKinds: CanonicalDeviceCommandKind[];
  powerRangeW?: {
    min: number;
    max: number;
  };
  supportedModes?: string[];
  minimumCommandWindowMinutes?: number;
  supportsOverlappingWindows?: boolean;
  supportsImmediateExecution?: boolean;
  schemaVersion: string;
}
