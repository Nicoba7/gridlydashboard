export type AgileRate = {
  time: string;
  pence: number;
};

export type ConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export type PlanSlot = {
  time: string;
  action: "CHARGE" | "EXPORT" | "HOLD" | "SOLAR";
  title: string;
  reason: string;
  price: number;
  color: string;
  requires: ConnectedDeviceId[];
  highlight?: boolean;
};

export type PlanSummary = {
  projectedEarnings: number;
  projectedSavings: number;
  cheapestSlot: string;
  cheapestPrice: number;
  peakSlot: string;
  peakPrice: number;
};

export function calculateProjectedBatteryArbitrage(
  cheapestPrice: number,
  peakPrice: number,
  batterySizeKwh = 10
) {
  return Number((((peakPrice - cheapestPrice) / 100) * batterySizeKwh).toFixed(2));
}

export function buildGridlyPlan(
  rates: AgileRate[],
  connectedDeviceIds: ConnectedDeviceId[],
  solarForecastKwh = 18.4
): { plan: PlanSlot[]; summary: PlanSummary } {
  const hasBattery = connectedDeviceIds.includes("battery");
  const hasEV = connectedDeviceIds.includes("ev");
  const hasSolar = connectedDeviceIds.includes("solar");
  const hasGrid = connectedDeviceIds.includes("grid");

  const cheapest = rates.reduce((min, r) => (r.pence < min.pence ? r : min), rates[0]);
  const peak = rates.reduce((max, r) => (r.pence > max.pence ? r : max), rates[0]);

  const secondCheap = [...rates]
    .sort((a, b) => a.pence - b.pence)
    .find((r) => r.time !== cheapest.time) ?? cheapest;

  const morningPeak =
    rates.find((r) => r.time === "08:00") ??
    [...rates].find((r) => r.pence >= 30) ??
    peak;

  const middaySolar =
    rates.find((r) => r.time === "11:00") ??
    rates.find((r) => r.time === "12:00") ??
    rates[24];

  const eveningTopUp =
    rates.find((r) => r.time === "20:00") ??
    rates.find((r) => r.time === "20:30") ??
    secondCheap;

  const projectedEarnings = hasBattery && hasGrid
    ? Number(((peak.pence / 100) * 8).toFixed(2))
    : 0;

  const projectedSavings = hasBattery
    ? Number((calculateProjectedBatteryArbitrage(cheapest.pence, peak.pence) * 0.45).toFixed(2))
    : hasEV
      ? Number(((secondCheap.pence / 100) * 3.7 * 2).toFixed(2))
      : 0;

  const plan: PlanSlot[] = [
    {
      time: cheapest.time,
      action: "CHARGE",
      title: hasBattery ? "Charging your battery" : "Charging at the cheapest slot",
      reason: "Cheap rate — best price of the night",
      price: cheapest.pence,
      color: "#22C55E",
      requires: hasBattery ? ["battery"] : [],
      highlight: true,
    },
    {
      time: secondCheap.time,
      action: "HOLD",
      title: "Resting overnight",
      reason: "Nothing to do — holding steady",
      price: secondCheap.pence,
      color: "#6B7280",
      requires: [],
      highlight: false,
    },
    {
      time: morningPeak.time,
      action: "EXPORT",
      title: hasGrid ? "Selling to the grid" : "Avoiding peak prices",
      reason: hasGrid
        ? "Price is high — earning for you"
        : "Peak price window — avoiding expensive import",
      price: morningPeak.pence,
      color: "#F59E0B",
      requires: hasGrid ? ["battery", "grid"] : ["battery"],
      highlight: true,
    },
    {
      time: middaySolar.time,
      action: "SOLAR",
      title: "Solar powering your home",
      reason:
        solarForecastKwh > 15
          ? "Strong solar forecast — free electricity from your panels"
          : "Solar available — reducing grid import",
      price: middaySolar.pence,
      color: "#F59E0B",
      requires: hasSolar ? ["solar"] : [],
      highlight: false,
    },
    {
      time: peak.time,
      action: "EXPORT",
      title: "Peak earnings window",
      reason: "Best price of the day",
      price: peak.pence,
      color: "#F59E0B",
      requires: hasGrid ? ["battery", "grid"] : ["battery"],
      highlight: true,
    },
    {
      time: eveningTopUp.time,
      action: "CHARGE",
      title: hasEV ? "Topping up for tomorrow" : "Preparing for tomorrow",
      reason: "Price dropping — refilling ready for the morning",
      price: eveningTopUp.pence,
      color: "#22C55E",
      requires: hasBattery ? ["battery"] : hasEV ? ["ev"] : [],
      highlight: false,
    },
  ];

  return {
    plan,
    summary: {
      projectedEarnings,
      projectedSavings,
      cheapestSlot: cheapest.time,
      cheapestPrice: cheapest.pence,
      peakSlot: peak.time,
      peakPrice: peak.pence,
    },
  };
}
