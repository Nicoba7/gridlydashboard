import type { DeviceState } from "./device";

/**
 * Aggregate view of the home energy system at a single point in time.
 *
 * The optimizer should consume this shape instead of reading vendor-specific
 * state directly from UI fixtures or API payloads.
 */
export interface SystemState {
  /** Internal Gridly site or household identifier. */
  siteId: string;
  /** Timestamp when the aggregate system snapshot was assembled. */
  capturedAt: string;
  /** IANA timezone identifier used for tariff windows and deadlines. */
  timezone: string;
  /** All normalized devices currently known to the site. */
  devices: DeviceState[];
  /** Current total household demand. */
  homeLoadW: number;
  /** Current total solar production across all inverters. */
  solarGenerationW: number;
  /** Current total battery power. Positive means discharging to the home/grid. */
  batteryPowerW: number;
  /** Current total EV charging demand. */
  evChargingPowerW: number;
  /** Current net grid flow. Positive means importing from the grid. */
  gridPowerW: number;
  /** Aggregate battery state of charge across connected storage devices. */
  batterySocPercent?: number;
  /** Aggregate battery usable capacity across connected storage devices. */
  batteryCapacityKwh?: number;
  /** Aggregate EV state of charge when a connected vehicle is known. */
  evSocPercent?: number;
  /** Whether any EV charger currently has a vehicle connected. */
  evConnected?: boolean;
  /** Current import price used for real-time operating decisions. */
  currentImportRatePencePerKwh?: number;
  /** Current export price used for real-time operating decisions. */
  currentExportRatePencePerKwh?: number;
}