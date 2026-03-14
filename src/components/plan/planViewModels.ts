import { PricingState } from "../../hooks/useAgileRates";
import { PlanSlot, PlanSummary, ConnectedDeviceId, OptimisationMode, GridlyPlanSummary, GridlyPlanSession } from "../../lib/gridlyPlan";

export type PlanHeroViewModel = {
  title: string;
  value: string;
  outcomes: string[];
  trustNote: string;
  statusNote?: string;
};

export type PlanTimelineRow = {
  time: string;
  action: string;
  reason: string;
  value: string;
  color: string;
  highlight?: boolean;
  modeTag?: string;
  emphasis?: "high" | "medium" | "low";
  coreAction?: "charge_ev" | "charge_battery" | "export" | "solar_use" | "hold";
};

export type PlanTimelineViewModel = {
  rows: PlanTimelineRow[];
};

export type PriceWindowsViewModel = {
  cheapestWindow: string;
  cheapestRate: number;
  peakWindow: string;
  peakRate: number;
  solarWindow?: string;
  solarStrength?: string;
};

export type PlanSummaryViewModel = {
  title: string;
  summary: string;
  modeTag: string;
  highlights: string[];
};

export type AIInsightViewModel = {
  insight: string;
};

export type OptimisationModeViewModel = {
  mode: OptimisationMode;
  options: { id: OptimisationMode; label: string; description: string }[];
};

export function getBarColor(p: number) {
  if (p < 10) return "#22C55E";
  if (p < 20) return "#F59E0B";
  if (p < 30) return "#F97316";
  return "#EF4444";
}

function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}

function formatRange(start: string, end: string) {
  if (start === end) return start;
  return `${start}–${end}`;
}

function coreActionFromSessionType(sessionType: GridlyPlanSession["type"]) {
  if (sessionType === "ev_charge") return "charge_ev" as const;
  if (sessionType === "battery_charge") return "charge_battery" as const;
  if (sessionType === "solar_use") return "solar_use" as const;
  if (sessionType === "export") return "export" as const;
  return "hold" as const;
}

function sessionActionLabel(sessionType: GridlyPlanSession["type"]) {
  if (sessionType === "battery_charge") return "Battery charging overnight";
  if (sessionType === "ev_charge") return "Charging EV overnight";
  if (sessionType === "export") return "Selling energy during peak prices";
  if (sessionType === "solar_use") return "Solar covering home demand";
  return "Holding steady";
}

function compactReason(
  coreAction: ReturnType<typeof coreActionFromSessionType>,
  mode: OptimisationMode,
  hasManySlots: boolean,
  context: { hasBattery: boolean; hasSolar: boolean; hasBatteryCharge: boolean }
) {
  if (coreAction === "charge_battery") {
    if (mode === "CHEAPEST") return hasManySlots ? "Top up across the cheapest overnight windows." : "Top up when power is cheapest.";
    if (mode === "BALANCED") return "Small top-up to keep tomorrow comfortable and protected.";
    return "Only topping up if reserve support is needed.";
  }

  if (coreAction === "charge_ev") {
    if (mode === "CHEAPEST") return "Charge before morning in the lowest-price slots.";
    if (mode === "BALANCED") return "Charge steadily overnight so it is ready by morning.";
    return "Charge before morning in cleaner grid windows.";
  }

  if (coreAction === "export") {
    if (mode === "CHEAPEST") return "Sell power when prices are strongest.";
    if (mode === "BALANCED") return "Export only when value is clearly worthwhile.";
    return "Export mainly from clean surplus periods.";
  }

  if (coreAction === "solar_use") return "Let solar cover home demand around midday.";

  if (mode === "BALANCED" && context.hasBattery && !context.hasBatteryCharge) {
    return "Battery reserve is healthy, so Gridly avoids unnecessary overnight charging.";
  }

  if (mode === "GREENEST" && context.hasBattery && !context.hasBatteryCharge) {
    return context.hasSolar
      ? "Holding overnight so tomorrow’s solar can do more of the charging."
      : "Holding for cleaner grid periods before charging.";
  }

  if (mode === "CHEAPEST" && context.hasBattery && !context.hasBatteryCharge) {
    return "No strong overnight arbitrage window, so Gridly keeps your battery steady.";
  }

  return "No action needed in this window.";
}

function formatSessionOutcome(session: GridlyPlanSession) {
  return sessionActionLabel(session.type);
}

export function selectDisplaySessions(sessions: GridlyPlanSession[]) {
  const actionable = sessions.filter((session) => session.type !== "hold");
  return actionable.length ? actionable : sessions;
}

export function buildPlanHeroViewModel({
  summary,
  gridlySummary,
  sessions,
  pricingStatus,
  loading,
}: {
  summary: PlanSummary;
  gridlySummary: GridlyPlanSummary;
  sessions: GridlyPlanSession[];
  pricingStatus: PricingState;
  loading: boolean;
}): PlanHeroViewModel {
  const value = summary.projectedEarnings + summary.projectedSavings;

  const trustNote = loading
    ? "Updating with the latest prices."
    : pricingStatus === "live"
    ? "Using live prices — this plan updates automatically."
    : pricingStatus === "fallback_live"
    ? "Using estimated prices for now — live prices will update automatically."
    : "Using demo prices for preview mode.";

  const statusNote = loading
    ? "Loading prices..."
    : pricingStatus === "live"
    ? "Live pricing"
    : pricingStatus === "fallback_live"
    ? "Estimated pricing"
    : "Demo pricing";

  return {
    title: gridlySummary.planHeadline,
    value: `+${formatMoney(value)}`,
    outcomes: sessions.map(formatSessionOutcome),
    trustNote,
    statusNote,
  };
}

export function buildPlanTimelineViewModel(
  sessions: GridlyPlanSession[],
  connectedDeviceIds: ConnectedDeviceId[],
  mode: OptimisationMode
): PlanTimelineViewModel {
  const hasBattery = connectedDeviceIds.includes("battery");
  const hasSolar = connectedDeviceIds.includes("solar");

  const hasBatteryCharge = sessions.some((session) => session.type === "battery_charge");

  return {
    rows: sessions.map((session) => {
      const coreAction = coreActionFromSessionType(session.type);
      return {
        time: formatRange(session.start, session.end),
        action: sessionActionLabel(session.type),
        reason: compactReason(coreAction, mode, session.slotCount > 1, {
          hasBattery,
          hasSolar,
          hasBatteryCharge,
        }),
        value: session.priceRange ?? (session.priceMin === session.priceMax ? `${session.priceMin.toFixed(1)}p` : `${session.priceMin.toFixed(1)}–${session.priceMax.toFixed(1)}p`),
        color: session.color,
        highlight: session.highlight,
        modeTag:
          mode === "CHEAPEST"
            ? "Cheapest plan"
            : mode === "BALANCED"
            ? "Balanced plan"
            : "Greenest plan",
        emphasis:
          coreAction === "export"
            ? "high"
            : coreAction === "charge_ev" || coreAction === "charge_battery"
            ? mode === "BALANCED"
              ? "medium"
              : "high"
            : "low",
        coreAction,
      };
    }),
  };
}

export function buildPriceWindowsViewModel(
  summary: PlanSummary,
  solarSlot?: PlanSlot,
  solarForecastKwh?: number
): PriceWindowsViewModel {
  const solarStrength = solarForecastKwh
    ? solarForecastKwh > 15
      ? "Strong solar forecast"
      : "Solar expected"
    : undefined;

  return {
    cheapestWindow: summary.cheapestSlot,
    cheapestRate: summary.cheapestPrice,
    peakWindow: summary.peakSlot,
    peakRate: summary.peakPrice,
    solarWindow: solarSlot?.time,
    solarStrength,
  };
}

export function buildPlanSummaryViewModel({
  summary,
  gridlySummary,
  sessions,
}: {
  summary: PlanSummary;
  gridlySummary: GridlyPlanSummary;
  sessions: GridlyPlanSession[];
}): PlanSummaryViewModel {
  const highlights = sessions.map(formatSessionOutcome);

  return {
    title: "Why this plan works",
    summary: gridlySummary.customerReason,
    modeTag: summary.mode,
    highlights,
  };
}

export function buildAIInsightViewModel({
  gridlySummary,
  summary,
  pricingStatus,
  mode,
}: {
  gridlySummary: GridlyPlanSummary;
  summary: PlanSummary;
  pricingStatus: PricingState;
  mode: OptimisationMode;
}): AIInsightViewModel | null {
  if (pricingStatus === "fallback_live") {
    return {
      insight: "Live prices are briefly unavailable, so Gridly is using a conservative estimate and will refresh automatically.",
    };
  }

  if (pricingStatus === "sandbox") {
    return {
      insight: "You’re viewing a demo plan. Connect live pricing to unlock real-time optimisation.",
    };
  }
  if (!gridlySummary.showInsightCard) return null;

  if (gridlySummary.intent === "use_solar" && mode === "GREENEST") {
    return {
      insight: "Balanced may look similar tonight, but Greenest is intentionally waiting for cleaner daytime and solar energy.",
    };
  }

  if (gridlySummary.intent === "avoid_peak_import" && mode === "BALANCED") {
    return {
      insight: "Balanced is holding steady because your reserve is already healthy and extra cycling adds little value tonight.",
    };
  }

  if (gridlySummary.intent === "capture_cheap_energy" && mode === "CHEAPEST") {
    return {
      insight: "Cheapest is leaning into low overnight prices to capture more value by tomorrow.",
    };
  }

  if (gridlySummary.intent === "protect_deadline") {
    return {
      insight: "Your EV deadline is the priority, so Gridly is shaping the rest of the plan around being ready on time.",
    };
  }

  if (gridlySummary.intent === "export_at_peak") {
    return {
      insight: "Gridly is saving flexibility for the most valuable part of tomorrow rather than acting early.",
    };
  }

  return null;
}

export function buildOptimisationModeViewModel(mode: OptimisationMode): OptimisationModeViewModel {
  return {
    mode,
    options: [
      {
        id: "CHEAPEST",
        label: "Cheapest",
        description: "Prioritise minimum import price and strong arbitrage windows.",
      },
      {
        id: "BALANCED",
        label: "Balanced",
        description: "Balance cost, battery wear, and clean energy periods.",
      },
      {
        id: "GREENEST",
        label: "Greenest",
        description: "Prioritise solar and lower-carbon windows over raw price.",
      },
    ],
  };
}
