export type AveumMode =
  | "CHARGE"
  | "EXPORT"
  | "HOLD"
  | "SOLAR"
  | "EV_CHARGE"
  | "SPLIT_CHARGE";

export type EVPriority =
  | "BATTERY_FIRST"
  | "EV_FIRST"
  | "SPLIT"
  | "WAIT";

type EngineInput = {
  price: number;
  solarW: number;
  batteryPct: number;
  hasBattery: boolean;
  hasSolar: boolean;
  hasEV: boolean;
  hasGrid: boolean;

  evConnected?: boolean;
  evPct?: number;
  evTargetPct?: number;
  readyByHour?: number;
};

const CHEAP_PRICE = 8;
const OKAY_PRICE = 12;
const EXPENSIVE_PRICE = 30;

export function getEVPriority(input: EngineInput): EVPriority {
  const {
    hasBattery,
    hasEV,
    evConnected = false,
    batteryPct,
    evPct = 20,
    evTargetPct = 80,
    readyByHour = 7,
  } = input;

  if (!hasEV || !evConnected) return "WAIT";

  const evGap = Math.max(0, evTargetPct - evPct);
  const urgent = readyByHour <= 7;

  if (!hasBattery) return evGap > 0 ? "EV_FIRST" : "WAIT";

  if (batteryPct < 25) return "BATTERY_FIRST";
  if (evGap >= 35 && urgent) return "EV_FIRST";
  if (batteryPct >= 40 && evGap >= 15) return "SPLIT";
  if (evGap > 0) return "EV_FIRST";

  return "WAIT";
}

export function getAveumMode(input: EngineInput): AveumMode {
  const {
    price,
    solarW,
    batteryPct,
    hasBattery,
    hasSolar,
    hasEV,
    hasGrid,
    evConnected = false,
  } = input;

  const evPriority = getEVPriority(input);

  if (hasSolar && solarW > 500) {
    if (hasEV && evConnected && solarW > 2000) return "EV_CHARGE";
    return "SOLAR";
  }

  if (price >= EXPENSIVE_PRICE && hasBattery && hasGrid && batteryPct > 20) {
    return "EXPORT";
  }

  if (price <= CHEAP_PRICE) {
    if (evPriority === "EV_FIRST") return "EV_CHARGE";
    if (evPriority === "SPLIT") return "SPLIT_CHARGE";
    if (hasBattery) return "CHARGE";
  }

  if (price <= OKAY_PRICE && evPriority === "EV_FIRST") {
    return "EV_CHARGE";
  }

  return "HOLD";
}

export function getModeDescription(
  mode: AveumMode,
  input: EngineInput
): string {
  const {
    price,
    batteryPct,
    evPct = 20,
    evTargetPct = 80,
    readyByHour = 7,
  } = input;

  switch (mode) {
    case "CHARGE":
      return `Buying at ${price}p — filling your battery while prices are low.`;

    case "EV_CHARGE":
      return `TEST: old gridlyEngine is still powering this screen.`;

    case "SPLIT_CHARGE":
      return `Cheap slot at ${price}p — splitting energy between battery (${batteryPct}%) and EV (${evPct}%).`;

    case "EXPORT":
      return `Selling to the grid at ${price}p — peak price, earning for you now.`;

    case "SOLAR":
      return `Solar is generating — using your own power before importing from the grid.`;

    case "HOLD":
    default:
      return `Price is ${price}p — waiting for a better slot or holding current charge.`;
  }
}
