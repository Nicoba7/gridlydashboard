/**
 * Forecast contracts shared by solar, demand, and carbon services.
 */

/**
 * Generic forecast point for a fixed time slot.
 */
export interface ForecastPoint {
  /** Inclusive start timestamp for the slot. */
  startAt: string;
  /** Exclusive end timestamp for the slot. */
  endAt: string;
  /** Forecasted value for the slot. */
  value: number;
  /** Optional confidence score from 0 to 1. */
  confidence?: number;
}

/**
 * Collection of forward-looking signals used by the optimizer.
 */
export interface Forecasts {
  /** Timestamp when the forecast package was assembled. */
  generatedAt: string;
  /** Horizon start for the optimization window. */
  horizonStartAt: string;
  /** Horizon end for the optimization window. */
  horizonEndAt: string;
  /** Slot resolution in minutes. Gridly currently operates in 30-minute slots. */
  slotDurationMinutes: number;
  /** Forecasted household demand for each slot, in kWh. */
  householdLoadKwh: ForecastPoint[];
  /** Forecasted solar generation for each slot, in kWh. */
  solarGenerationKwh: ForecastPoint[];
  /** Forecasted carbon intensity for each slot, in gCO2/kWh. */
  carbonIntensity?: ForecastPoint[];
}