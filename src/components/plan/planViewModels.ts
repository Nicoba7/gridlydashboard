import { PricingState } from "../../hooks/useAgileRates";
import { PlanSlot, PlanSummary, ConnectedDeviceId, OptimisationMode, AveumPlanSummary, AveumPlanSession } from "../../types/planCompat";
import { buildDecisionExplanation } from "../../lib/decisionExplanation";

export type PlanHeroViewModel = {
  title: string;
  subline: string;
  value: string;
  outcomes: string[];
  trustNote: string;
  statusNote?: string;
  confidenceLabel: string;
  confidencePct?: number;
  confidenceReason?: string;
  whatChanged?: string;
  projectedSavings: number;
  projectedEarnings: number;
  cheapestPrice: number;
};

export type PlanTimelineRow = {
  time: string;
  action: string;
  reason: string;
  reasoning: string[];
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
  options: { id: OptimisationMode; label: string; description: string; behaviorSignal: string }[];
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

function coreActionFromSessionType(sessionType: AveumPlanSession["type"]) {
  if (sessionType === "ev_charge") return "charge_ev" as const;
  if (sessionType === "battery_charge") return "charge_battery" as const;
  if (sessionType === "solar_use") return "solar_use" as const;
  if (sessionType === "export") return "export" as const;
  return "hold" as const;
}

export function getSessionActionLabel(sessionType: AveumPlanSession["type"]) {
  if (sessionType === "battery_charge") return "Top up battery while rates are low";
  if (sessionType === "ev_charge") return "Charge your EV before morning";
  if (sessionType === "export") return "Sell surplus when prices peak";
  if (sessionType === "solar_use") return "Let solar power the home";
  return "Nothing to do";
}

function buildCalmHeroTitle({
  intent,
  sessions,
  solarForecastKwh,
  summary,
}: {
  intent: AveumPlanSummary["intent"];
  sessions: AveumPlanSession[];
  solarForecastKwh: number;
  summary: PlanSummary;
}): string {
  const hasEV = sessions.some((s) => s.type === "ev_charge");
  const hasBatteryCharge = sessions.some((s) => s.type === "battery_charge");
  const hasExport = sessions.some((s) => s.type === "export");
  const hasSolarSession = sessions.some((s) => s.type === "solar_use");
  const priceSpread = summary.peakPrice - summary.cheapestPrice;

  if (hasEV && hasBatteryCharge) return "Tomorrow is already prepared";
  if (intent === "use_solar" || (hasSolarSession && solarForecastKwh >= 12)) return "Tomorrow is already optimised";
  if (intent === "capture_cheap_energy" || (hasBatteryCharge && priceSpread >= 6)) return "Tomorrow is already optimised";
  if (intent === "export_at_peak" || hasExport) return "Tomorrow is already optimised";
  if (intent === "avoid_peak_import") return "Tomorrow is already prepared";
  return "Tomorrow is already optimised";
}

function buildConfidenceViewModel({
  pricingStatus,
  loading,
  summary,
  solarForecastKwh,
  sessions,
}: {
  pricingStatus: PricingState;
  loading: boolean;
  summary: PlanSummary;
  solarForecastKwh: number;
  sessions: AveumPlanSession[];
}) {
  if (loading) {
    return {
      confidenceLabel: "Forecast still settling",
      confidencePct: 74,
      confidenceReason: "Updating live prices and weather data.",
    };
  }

  if (pricingStatus === "fallback_live") {
    return {
      confidenceLabel: "Forecast still settling",
      confidencePct: 79,
      confidenceReason: "Prices may still shift.",
    };
  }

  let confidencePct = pricingStatus === "live" ? 86 : 81;
  const spread = summary.peakPrice - summary.cheapestPrice;
  const hasSolarSession = sessions.some((s) => s.type === "solar_use");
  const hasBatteryCharge = sessions.some((s) => s.type === "battery_charge");

  if (spread >= 10) confidencePct += 3;
  if (spread >= 6 && spread < 10) confidencePct += 1;
  if (solarForecastKwh >= 14 && hasSolarSession) confidencePct += 4;
  if (hasBatteryCharge && summary.cheapestPrice <= 12) confidencePct += 2;

  confidencePct = Math.min(97, Math.max(72, confidencePct));

  const confidenceLabel = confidencePct >= 90
    ? "High confidence"
    : confidencePct >= 83
    ? "Good confidence"
    : "Forecast still settling";

  let confidenceReason = "Stable overnight prices.";
  if (solarForecastKwh >= 14 && hasSolarSession) {
    confidenceReason = "Strong solar forecast.";
  } else if (spread < 5) {
    confidenceReason = "Prices may still shift.";
  } else if (pricingStatus === "sandbox") {
    confidenceReason = "Using demo conditions.";
  }

  return {
    confidenceLabel,
    confidencePct,
    confidenceReason,
  };
}

function buildWhatChangedMessage({
  sessions,
  solarForecastKwh,
  summary,
}: {
  sessions: AveumPlanSession[];
  solarForecastKwh: number;
  summary: PlanSummary;
}) {
  const hasBatteryCharge = sessions.some((s) => s.type === "battery_charge");
  const hasExport = sessions.some((s) => s.type === "export");
  const spread = summary.peakPrice - summary.cheapestPrice;

  if (solarForecastKwh >= 14 && !hasBatteryCharge) {
    return "More solar than today, so overnight charging is lighter.";
  }

  if (hasExport && spread >= 10) {
    return "Stronger peak prices mean Aveum plans to export later.";
  }

  if (hasBatteryCharge && summary.cheapestPrice <= 10) {
    return "Cheaper overnight rates allow a deeper battery top-up.";
  }

  return undefined;
}

function conciseSubline(text: string): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("overnight prices are low enough")) {
    return "Overnight prices are low, so Aveum charges before tomorrow’s expensive periods.";
  }

  if (normalized.includes("spacing charging through sensible overnight windows")) {
    return "Aveum spaces overnight charging so your EV is ready without unnecessary battery wear.";
  }

  if (normalized.includes("strong solar is expected tomorrow")) {
    return "Strong solar is expected tomorrow, so Aveum avoids unnecessary overnight charging.";
  }

  if (normalized.includes("capturing cheaper energy now")) {
    return "Aveum captures cheaper energy now for tomorrow’s highest-value periods.";
  }

  if (normalized.includes("battery reserve is already healthy")) {
    return "Battery reserve is already healthy, so extra overnight charging adds little value.";
  }

  if (normalized.includes("cleaner daytime and solar energy")) {
    return "Aveum is waiting for cleaner daytime and solar energy instead of charging overnight.";
  }

  if (normalized.includes("do not create a strong enough saving opportunity")) {
    return "Overnight prices are not strong enough to justify charging tonight.";
  }

  if (text.length <= 92) return text;

  const firstSentence = text.split(".").map((part) => part.trim()).filter(Boolean)[0];
  if (firstSentence && firstSentence.length <= 92) {
    return `${firstSentence}.`;
  }

  return text.slice(0, 92).trim();
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
    return "Battery reserve is healthy, so Aveum avoids unnecessary overnight charging.";
  }

  if (mode === "GREENEST" && context.hasBattery && !context.hasBatteryCharge) {
    return context.hasSolar
      ? "Holding overnight so tomorrow’s solar can do more of the charging."
      : "Holding for cleaner grid periods before charging.";
  }

  if (mode === "CHEAPEST" && context.hasBattery && !context.hasBatteryCharge) {
    return "No strong overnight arbitrage window, so Aveum keeps your battery steady.";
  }

  return "No action needed in this window.";
}

function formatSessionOutcome(session: AveumPlanSession) {
  return getSessionActionLabel(session.type);
}

export function selectDisplaySessions(sessions: AveumPlanSession[]) {
  const actionable = sessions.filter((session) => session.type !== "hold");
  return actionable.length ? actionable : sessions;
}

function toSlotIndex(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours * 2) + (minutes >= 30 ? 1 : 0);
}

function toHHMM(slotIndex: number) {
  const normalized = ((slotIndex % 48) + 48) % 48;
  const hours = String(Math.floor(normalized / 2)).padStart(2, "0");
  const minutes = normalized % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
}

function formatPriceRange(min: number, max: number) {
  return min === max ? `${min.toFixed(1)}p` : `${min.toFixed(1)}–${max.toFixed(1)}p`;
}

function mergeSessionGroup(sessions: AveumPlanSession[]): AveumPlanSession {
  const sorted = [...sessions].sort((a, b) => toSlotIndex(a.start) - toSlotIndex(b.start));
  const first = sorted[0];
  const minStart = Math.min(...sorted.map((session) => toSlotIndex(session.start)));
  const maxEnd = Math.max(...sorted.map((session) => toSlotIndex(session.end)));
  const priceMin = Math.min(...sorted.map((session) => session.priceMin));
  const priceMax = Math.max(...sorted.map((session) => session.priceMax));
  const reasoning = [...new Set(sorted.flatMap((session) => session.reasoning ?? []))];

  return {
    type: first.type,
    start: toHHMM(minStart),
    end: toHHMM(maxEnd),
    reasoning,
    priceRange: formatPriceRange(priceMin, priceMax),
    priceMin,
    priceMax,
    color: first.color,
    highlight: sorted.some((session) => session.highlight),
    slotCount: sorted.reduce((total, session) => total + session.slotCount, 0),
  };
}

function isOvernightSession(session: AveumPlanSession) {
  const start = toSlotIndex(session.start);
  const end = toSlotIndex(session.end);
  return start >= 44 || start < 16 || end <= 16;
}

export function groupDisplaySessions(sessions: AveumPlanSession[]) {
  if (sessions.length <= 1) return sessions;

  const sorted = [...sessions].sort((a, b) => toSlotIndex(a.start) - toSlotIndex(b.start));
  const overnightChargeTypes = new Set<AveumPlanSession["type"]>(["battery_charge", "ev_charge"]);

  const overnightGrouped: AveumPlanSession[] = [];
  for (const type of overnightChargeTypes) {
    const matching = sorted.filter((session) => session.type === type && isOvernightSession(session));
    if (matching.length) overnightGrouped.push(mergeSessionGroup(matching));
  }

  const usedOvernight = new Set(
    sorted
      .filter((session) => overnightChargeTypes.has(session.type) && isOvernightSession(session))
      .map((session) => `${session.type}|${session.start}|${session.end}`)
  );

  const remainder = sorted.filter(
    (session) => !usedOvernight.has(`${session.type}|${session.start}|${session.end}`)
  );

  const mergedRemainder: AveumPlanSession[] = [];
  for (const session of remainder) {
    const last = mergedRemainder[mergedRemainder.length - 1];
    if (!last) {
      mergedRemainder.push(session);
      continue;
    }

    const sameType = last.type === session.type;
    const gap = toSlotIndex(session.start) - toSlotIndex(last.end);
    const nearAdjacent = gap >= 0 && gap <= 1;

    if (sameType && nearAdjacent) {
      mergedRemainder[mergedRemainder.length - 1] = mergeSessionGroup([last, session]);
    } else {
      mergedRemainder.push(session);
    }
  }

  return [...overnightGrouped, ...mergedRemainder].sort((a, b) => toSlotIndex(a.start) - toSlotIndex(b.start));
}

export function buildPlanHeroViewModel({
  summary,
  gridlySummary,
  sessions,
  pricingStatus,
  loading,
  solarForecastKwh,
}: {
  summary: PlanSummary;
  gridlySummary: AveumPlanSummary;
  sessions: AveumPlanSession[];
  pricingStatus: PricingState;
  loading: boolean;
  solarForecastKwh: number;
}): PlanHeroViewModel {
  const value = summary.projectedEarnings + summary.projectedSavings;

  const trustNote = loading
    ? "Refreshing the latest prices and forecasts."
    : pricingStatus === "live"
    ? "Using live prices. Aveum will adapt automatically if conditions shift."
    : pricingStatus === "fallback_live"
    ? "Live prices are briefly delayed. Aveum is running a safe plan and will refresh automatically."
    : "Preview mode: showing a representative strategy.";

  const statusNote = loading
    ? "Status: Refreshing"
    : pricingStatus === "live"
    ? "Status: Live"
    : pricingStatus === "fallback_live"
    ? "Status: Estimated"
    : "Status: Preview";

  const confidence = buildConfidenceViewModel({
    pricingStatus,
    loading,
    summary,
    solarForecastKwh,
    sessions,
  });

  return {
    title: buildCalmHeroTitle({
      intent: gridlySummary.intent,
      sessions,
      solarForecastKwh,
      summary,
    }),
    subline: conciseSubline(gridlySummary.customerReason),
    value: `+${formatMoney(value)}`,
    outcomes: sessions.map(formatSessionOutcome),
    trustNote,
    statusNote,
    confidenceLabel: confidence.confidenceLabel,
    confidencePct: confidence.confidencePct,
    confidenceReason: confidence.confidenceReason,
    whatChanged: buildWhatChangedMessage({
      sessions,
      solarForecastKwh,
      summary,
    }),
    projectedSavings: summary.projectedSavings,
    projectedEarnings: summary.projectedEarnings,
    cheapestPrice: summary.cheapestPrice,
  };
}

export function buildPlanTimelineViewModel(
  sessions: AveumPlanSession[],
  connectedDeviceIds: ConnectedDeviceId[],
  mode: OptimisationMode,
  options?: {
    solarForecastKwh?: number;
    cheapestPrice?: number;
    peakPrice?: number;
    cheapestWindow?: string;
    peakWindow?: string;
    evReadyBy?: string;
  }
): PlanTimelineViewModel {
  const hasBattery = connectedDeviceIds.includes("battery");
  const hasSolar = connectedDeviceIds.includes("solar");

  const hasBatteryCharge = sessions.some((session) => session.type === "battery_charge");

  return {
    rows: sessions.map((session) => {
      const coreAction = coreActionFromSessionType(session.type);
      return {
        time: formatRange(session.start, session.end),
        action: getSessionActionLabel(session.type),
        reason: compactReason(coreAction, mode, session.slotCount > 1, {
          hasBattery,
          hasSolar,
          hasBatteryCharge,
        }),
        reasoning: session.reasoning?.length
          ? session.reasoning.slice(0, 4)
          : buildDecisionExplanation(
              session,
              {
                solarForecastKwh: options?.solarForecastKwh,
                evReadyBy: options?.evReadyBy,
              },
              {
                cheapestPrice: options?.cheapestPrice,
                peakPrice: options?.peakPrice,
                cheapestWindow: options?.cheapestWindow,
                peakWindow: options?.peakWindow,
                gridCondition: hasSolar
                  ? "Grid conditions are steady, with solar expected to support demand."
                  : "Grid conditions are steady in this planning window.",
              }
            ),
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
  gridlySummary: AveumPlanSummary;
  sessions: AveumPlanSession[];
}): PlanSummaryViewModel {
  const highlights = sessions.map(formatSessionOutcome);

  return {
    title: "Why this plan wins",
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
  gridlySummary: AveumPlanSummary;
  summary: PlanSummary;
  pricingStatus: PricingState;
  mode: OptimisationMode;
}): AIInsightViewModel | null {
  if (pricingStatus === "fallback_live") {
    return {
      insight: "Live prices are briefly delayed. Aveum is running a safe plan and will refresh automatically.",
    };
  }

  if (pricingStatus === "sandbox") {
    return {
      insight: "This is a preview plan. Connect live pricing to enable real-time optimisation.",
    };
  }
  if (!gridlySummary.showInsightCard) return null;

  if (gridlySummary.intent === "use_solar" && mode === "GREENEST") {
    return {
      insight: "Greenest waits for cleaner daytime energy, even when Balanced looks similar overnight.",
    };
  }

  if (gridlySummary.intent === "avoid_peak_import" && mode === "BALANCED") {
    return {
      insight: "Balanced holds steady because reserve is healthy and extra cycling adds little value tonight.",
    };
  }

  if (gridlySummary.intent === "capture_cheap_energy" && mode === "CHEAPEST") {
    return {
      insight: "Cheapest leans into low overnight prices to capture more value by tomorrow.",
    };
  }

  if (gridlySummary.intent === "protect_deadline") {
    return {
      insight: "Your EV deadline is the priority, so the rest of the plan is shaped around being ready on time.",
    };
  }

  if (gridlySummary.intent === "export_at_peak") {
    return {
      insight: "Aveum keeps flexibility for tomorrow’s highest-value export window rather than acting early.",
    };
  }

  return null;
}

export function buildOptimisationModeViewModel(mode: OptimisationMode): OptimisationModeViewModel {
  return {
    mode,
    options: [
      {
        id: "CHEAPEST" as const,
        label: "Cheapest",
        description: "Lowest cost",
        behaviorSignal: "More battery cycling • low-tariff first",
      },
      {
        id: "BALANCED" as const,
        label: "Balanced",
        description: "Savings with battery care",
        behaviorSignal: "Moderate cycling • steadier behaviour",
      },
      {
        id: "GREENEST" as const,
        label: "Greenest",
        description: "More solar, less grid",
        behaviorSignal: "Self-consumption first • costs may be higher",
      },
    ],
  };
}
