/**
 * Normalized tariff schedule models.
 *
 * These types isolate pricing data from any single supplier API such as
 * Octopus Agile, Flux, or fixed export tariffs.
 */

export type TariffRateSource = "live" | "forecast" | "fixed" | "estimated";

export interface TariffRate {
  /** Inclusive start timestamp for the tariff slot. */
  startAt: string;
  /** Exclusive end timestamp for the tariff slot. */
  endAt: string;
  /** Price in pence per kWh for the slot. */
  unitRatePencePerKwh: number;
  /** Whether the slot comes from a live provider response or an estimate. */
  source: TariffRateSource;
}

export interface TariffSchedule {
  /** Internal Aveum tariff identifier. */
  tariffId: string;
  /** Supplier or tariff provider, for example Octopus. */
  provider: string;
  /** Human-readable plan name. */
  name: string;
  /** Settlement region or distribution area code when relevant. */
  regionCode?: string;
  /** Currency code for all monetary values. */
  currency: "GBP";
  /** Timestamp when the tariff schedule was last refreshed. */
  updatedAt: string;
  /** Import rates over the optimization horizon. */
  importRates: TariffRate[];
  /** Optional export rates over the optimization horizon. */
  exportRates?: TariffRate[];
  /** Optional daily standing charge, in pence. */
  standingChargePencePerDay?: number;
}