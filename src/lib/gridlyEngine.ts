export type GridlyMode =
  | "CHARGE"
  | "EXPORT"
  | "HOLD"
  | "SOLAR";

type EngineInput = {
  price: number;
  solarW: number;
  batteryPct: number;
  hasBattery: boolean;
  hasSolar: boolean;
  hasEV: boolean;
  hasGrid: boolean;
};

export function getGridlyMode(input: EngineInput): GridlyMode {
  const {
    price,
    solarW,
    batteryPct,
    hasBattery,
    hasSolar,
    hasEV,
    hasGrid,
  } = input;

  const CHEAP_PRICE = 8;
  const EXPENSIVE_PRICE = 30;

  // Solar running → prioritise solar
  if (hasSolar && solarW > 500) {
    return "SOLAR";
  }

  // Cheap electricity → charge
  if (price <= CHEAP_PRICE && hasBattery) {
    return "CHARGE";
  }

  // Expensive electricity → export
  if (price >= EXPENSIVE_PRICE && hasBattery && hasGrid && batteryPct > 20) {
    return "EXPORT";
  }

  return "HOLD";
}
