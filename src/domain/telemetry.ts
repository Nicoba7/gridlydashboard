import type { CanonicalChargingState } from "./observedDeviceState";

/**
 * Canonical vendor-neutral telemetry event emitted by adapter translation.
 */
export interface CanonicalDeviceTelemetry {
  deviceId: string;
  timestamp: string;
  batterySocPercent?: number;
  batteryPowerW?: number;
  evChargingPowerW?: number;
  chargingState?: CanonicalChargingState;
  evConnected?: boolean;
  solarGenerationW?: number;
  gridImportPowerW?: number;
  gridExportPowerW?: number;
  /** Battery state-of-health as a percentage of original capacity, 0–100. */
  batteryHealthPercent?: number;
  /** Cumulative full-cycle equivalent count reported by the battery BMS. */
  batteryCycleCount?: number;
  schemaVersion: string;
}
