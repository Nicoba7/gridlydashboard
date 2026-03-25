import type { AgileRate } from "../data/agileRates";

export type ConnectedDeviceId = "solar" | "battery" | "ev" | "grid";

export type OptimisationMode = "CHEAPEST" | "BALANCED" | "GREENEST";

export type PlanActionType = "CHARGE" | "EXPORT" | "HOLD" | "SOLAR";

export type PlanSlot = {
  time: string;
  action: PlanActionType;
  title: string;
  reason: string;
  price: number;
  color: string;
  requires: ConnectedDeviceId[];
  highlight?: boolean;
  score?: number;
  decisionType?: "battery_charge" | "ev_charge" | "export" | "solar" | "hold";
};

export type PlanWithSessions = PlanSlot[] & {
  sessions: AveumPlanSession[];
};

export type PlanSummary = {
  projectedEarnings: number;
  projectedSavings: number;
  cheapestSlot: string;
  cheapestPrice: number;
  peakSlot: string;
  peakPrice: number;
  mode: OptimisationMode;
  batteryReserveTargetPct: number;
  batteryReserveStartPct: number;
  batteryCyclesPlanned: number;
  evReadyBy?: string;
  evSlotsPlanned: number;
  estimatedImportSpend: number;
  estimatedExportRevenue: number;
  rationale: string[];
};

export type AveumPlanIntent =
  | "capture_cheap_energy"
  | "protect_deadline"
  | "use_solar"
  | "avoid_peak_import"
  | "export_at_peak";

export type AveumPlanSummary = {
  planHeadline: string;
  keyOutcomes: string[];
  intent: AveumPlanIntent;
  customerReason: string;
  estimatedValue?: number;
  showSolarInsight: boolean;
  showPriceChart: boolean;
  showInsightCard: boolean;
};

export type AveumPlanSessionType = "battery_charge" | "ev_charge" | "export" | "solar_use" | "hold";

export type AveumPlanSession = {
  type: AveumPlanSessionType;
  start: string;
  end: string;
  reasoning?: string[];
  priceRange?: string;
  priceMin: number;
  priceMax: number;
  color: string;
  highlight: boolean;
  slotCount: number;
};

export type AveumPlanOptions = {
  exportPriceRatio?: number;
  batteryCapacityKwh?: number;
  batteryStartPct?: number;
  batteryReservePct?: number;
  maxBatteryCyclesPerDay?: number;
  evTargetKwh?: number;
  evReadyBy?: string;
  nowSlotIndex?: number;
  carbonIntensity?: number[];
};

export type SlotDecision = {
  slotIndex: number;
  time: string;
  decisionType: "battery_charge" | "ev_charge" | "export" | "solar" | "hold";
  action: PlanActionType;
  score: number;
  reason: string;
  importPence: number;
  exportPence: number;
  requires: ConnectedDeviceId[];
  title: string;
};

type ModeTuning = {
  importWeight: number;
  exportWeight: number;
  greenWeight: number;
  reservePct: number;
  evReadyBy: string;
  maxBatteryCycles: number;
  minGapSlotsBetweenChargeWindows: number;
};

type NormalizedSlot = {
  slotIndex: number;
  time: string;
  importPence: number;
  exportPence: number;
  normalizedImport: number;
  normalizedExport: number;
  carbonIntensity: number;
  normalizedCarbon: number;
  solarPotentialKwh: number;
  normalizedSolar: number;
};

const MODE_TUNING: Record<OptimisationMode, ModeTuning> = {
  CHEAPEST: {
    importWeight: 0.7,
    exportWeight: 0.2,
    greenWeight: 0.1,
    reservePct: 22,
    evReadyBy: "07:00",
    maxBatteryCycles: 2,
    minGapSlotsBetweenChargeWindows: 4,
  },
  BALANCED: {
    importWeight: 0.5,
    exportWeight: 0.25,
    greenWeight: 0.25,
    reservePct: 30,
    evReadyBy: "07:00",
    maxBatteryCycles: 2,
    minGapSlotsBetweenChargeWindows: 6,
  },
  GREENEST: {
    importWeight: 0.25,
    exportWeight: 0.15,
    greenWeight: 0.6,
    reservePct: 36,
    evReadyBy: "07:00",
    maxBatteryCycles: 1,
    minGapSlotsBetweenChargeWindows: 8,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: number, min: number, max: number) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function parseSlotIndex(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return clamp(Math.floor(((hours * 60) + minutes) / 30), 0, 47);
}

function estimateCarbonIntensity(slotIndex: number) {
  const hour = slotIndex / 2;
  if (hour < 6) return 155;
  if (hour < 10) return 195;
  if (hour < 15) return 145;
  if (hour < 20) return 225;
  return 180;
}

function estimateSolarPotential(slotIndex: number, forecastKwh: number) {
  if (forecastKwh <= 0) return 0;
  const hour = slotIndex / 2;
  const distanceFromNoon = Math.abs(hour - 13);
  const bellCurve = Math.max(0, 1 - distanceFromNoon / 5);
  return Number((bellCurve * forecastKwh * 0.08).toFixed(3));
}

function selectWithGap<T extends NormalizedSlot>(candidates: T[], count: number, minGapSlots: number) {
  const selected: T[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const tooClose = selected.some((picked) => Math.abs(picked.slotIndex - candidate.slotIndex) < minGapSlots);
    if (!tooClose) {
      selected.push(candidate);
    }
  }
  return selected;
}

function buildNormalizedSlots(
  rates: AgileRate[],
  solarForecastKwh: number,
  carbonIntensity?: number[],
  exportPriceRatio = 0.72
) {
  const importPrices = rates.map((rate) => rate.pence);
  const exportPrices = rates.map((rate) => Number((rate.pence * exportPriceRatio).toFixed(2)));
  const carbonValues = rates.map((_, idx) => carbonIntensity?.[idx] ?? estimateCarbonIntensity(idx));
  const solarValues = rates.map((_, idx) => estimateSolarPotential(idx, solarForecastKwh));

  const minImport = Math.min(...importPrices);
  const maxImport = Math.max(...importPrices);
  const minExport = Math.min(...exportPrices);
  const maxExport = Math.max(...exportPrices);
  const minCarbon = Math.min(...carbonValues);
  const maxCarbon = Math.max(...carbonValues);
  const minSolar = Math.min(...solarValues);
  const maxSolar = Math.max(...solarValues);

  return rates.map((rate, slotIndex): NormalizedSlot => ({
    slotIndex,
    time: rate.time,
    importPence: rate.pence,
    exportPence: exportPrices[slotIndex],
    normalizedImport: normalize(rate.pence, minImport, maxImport),
    normalizedExport: normalize(exportPrices[slotIndex], minExport, maxExport),
    carbonIntensity: carbonValues[slotIndex],
    normalizedCarbon: normalize(carbonValues[slotIndex], minCarbon, maxCarbon),
    solarPotentialKwh: solarValues[slotIndex],
    normalizedSolar: normalize(solarValues[slotIndex], minSolar, maxSolar),
  }));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectBestConsecutiveBlock<T extends NormalizedSlot>(
  slots: T[],
  count: number,
  scoreFn: (slot: T) => number
) {
  if (!slots.length || count <= 0) return [] as T[];
  if (slots.length <= count) return [...slots].sort((a, b) => a.slotIndex - b.slotIndex);

  const sorted = [...slots].sort((a, b) => a.slotIndex - b.slotIndex);
  let bestBlock: T[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let start = 0; start <= sorted.length - count; start += 1) {
    const block = sorted.slice(start, start + count);
    let isConsecutive = true;
    for (let i = 1; i < block.length; i += 1) {
      if (block[i].slotIndex !== block[i - 1].slotIndex + 1) {
        isConsecutive = false;
        break;
      }
    }
    if (!isConsecutive) continue;

    const blockScore = block.reduce((sum, slot) => sum + scoreFn(slot), 0) / block.length;
    if (blockScore > bestScore) {
      bestScore = blockScore;
      bestBlock = block;
    }
  }

  if (bestBlock.length) return bestBlock;

  return [...sorted]
    .sort((a, b) => scoreFn(b) - scoreFn(a))
    .slice(0, count)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

function decisionToPlanSlot(decision: SlotDecision, mode: OptimisationMode): PlanSlot {
  const colorByAction: Record<PlanActionType, string> = {
    CHARGE: "#22C55E",
    EXPORT: "#F59E0B",
    SOLAR: "#F59E0B",
    HOLD: "#6B7280",
  };

  return {
    time: decision.time,
    action: decision.action,
    title: decision.title,
    reason: decision.reason,
    price: decision.action === "EXPORT" ? decision.exportPence : decision.importPence,
    color: colorByAction[decision.action],
    requires: decision.requires,
    highlight: mode === "CHEAPEST" ? decision.decisionType === "battery_charge" : decision.decisionType === "solar",
    score: Number(decision.score.toFixed(3)),
    decisionType: decision.decisionType,
  };
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function toHHMM(slotIndex: number) {
  const normalized = ((slotIndex % 48) + 48) % 48;
  const hours = String(Math.floor(normalized / 2)).padStart(2, "0");
  const minutes = normalized % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
}

function decisionToSessionType(decision: SlotDecision): AveumPlanSessionType {
  if (decision.decisionType === "battery_charge") return "battery_charge";
  if (decision.decisionType === "ev_charge") return "ev_charge";
  if (decision.decisionType === "export") return "export";
  if (decision.decisionType === "solar") return "solar_use";
  return "hold";
}

function decisionColor(decision: SlotDecision): string {
  if (decision.action === "CHARGE") return "#22C55E";
  if (decision.action === "EXPORT") return "#F59E0B";
  if (decision.action === "SOLAR") return "#F59E0B";
  return "#6B7280";
}

function decisionPrice(decision: SlotDecision): number {
  return decision.action === "EXPORT" ? decision.exportPence : decision.importPence;
}

function buildPlanSessions(decisions: SlotDecision[], mode: OptimisationMode): AveumPlanSession[] {
  if (!decisions.length) return [];

  const grouped: Array<{
    decisions: SlotDecision[];
    type: AveumPlanSessionType;
    endSlotIndex: number;
  }> = [];

  const sorted = [...decisions].sort((a, b) => a.slotIndex - b.slotIndex);

  for (const decision of sorted) {
    const type = decisionToSessionType(decision);
    const slotIndex = decision.slotIndex;
    const last = grouped[grouped.length - 1];

    if (!last) {
      grouped.push({ decisions: [decision], type, endSlotIndex: slotIndex });
      continue;
    }

    const sameAction = last.type === type;
    const consecutive = slotIndex === last.endSlotIndex + 1;

    if (sameAction && consecutive) {
      last.decisions.push(decision);
      last.endSlotIndex = slotIndex;
    } else {
      grouped.push({ decisions: [decision], type, endSlotIndex: slotIndex });
    }
  }

  return grouped.map((group) => {
    const first = group.decisions[0];
    const last = group.decisions[group.decisions.length - 1];
    const end = toHHMM(last.slotIndex + 1);
    const priceMin = Math.min(...group.decisions.map((decision) => decisionPrice(decision)));
    const priceMax = Math.max(...group.decisions.map((decision) => decisionPrice(decision)));

    return {
      type: group.type,
      start: first.time,
      end,
      priceRange: priceMin === priceMax ? `${priceMin.toFixed(1)}p` : `${priceMin.toFixed(1)}–${priceMax.toFixed(1)}p`,
      priceMin,
      priceMax,
      color: decisionColor(first),
      highlight: group.decisions.some((decision) =>
        mode === "CHEAPEST" ? decision.decisionType === "battery_charge" : decision.decisionType === "solar"
      ),
      slotCount: group.decisions.length,
    };
  });
}

function buildAveumCustomerSummary({
  mode,
  hasBattery,
  hasEV,
  hasSolar,
  strongSolarExpected,
  selectedSolar,
  selectedExports,
  selectedBatteryCharges,
  summary,
}: {
  mode: OptimisationMode;
  hasBattery: boolean;
  hasEV: boolean;
  hasSolar: boolean;
  strongSolarExpected: boolean;
  selectedSolar?: NormalizedSlot;
  selectedExports: Array<NormalizedSlot & { planScore: number }>;
  selectedBatteryCharges: Array<NormalizedSlot & { planScore: number }>;
  summary: PlanSummary;
}): AveumPlanSummary {
  const estimatedValue = Number((summary.projectedEarnings + summary.projectedSavings).toFixed(2));
  const noBatteryCharge = hasBattery && summary.batteryCyclesPlanned === 0;
  const hasExport = selectedExports.length > 0;
  const hasSolarPlan = hasSolar && !!selectedSolar;

  let intent: AveumPlanIntent = "avoid_peak_import";
  if (mode === "GREENEST" && strongSolarExpected && noBatteryCharge) {
    intent = "use_solar";
  } else if (hasEV && summary.evSlotsPlanned > 0) {
    intent = "protect_deadline";
  } else if (hasExport) {
    intent = "export_at_peak";
  } else if (summary.batteryCyclesPlanned > 0) {
    intent = "capture_cheap_energy";
  }

  let planHeadline = "Tomorrow is already sorted.";
  let customerReason = "Aveum has found a sensible plan for tonight and tomorrow.";

  if (intent === "capture_cheap_energy") {
    planHeadline =
      mode === "CHEAPEST"
        ? "Charge low overnight, then use energy when it is worth more."
        : "A light overnight top-up keeps tomorrow covered.";
    customerReason =
      mode === "CHEAPEST"
        ? "Overnight prices are low enough to make charging worthwhile before the more expensive periods tomorrow."
        : "Aveum is topping up a little overnight because it improves flexibility without overworking the battery.";
  } else if (intent === "protect_deadline") {
    planHeadline = "Your EV will be ready by morning.";
    customerReason =
      mode === "GREENEST"
        ? "Aveum is meeting your EV deadline while leaning toward cleaner charging periods."
        : mode === "BALANCED"
        ? "Aveum is spacing charging through sensible overnight windows so your EV is ready without unnecessary battery wear elsewhere."
        : "Aveum is using the lowest practical overnight slots to hit your EV ready time.";
  } else if (intent === "use_solar") {
    planHeadline = "Wait overnight, then let tomorrow's solar do the work.";
    customerReason = "Strong solar is expected tomorrow, so Aveum is avoiding unnecessary overnight charging from the grid.";
  } else if (intent === "export_at_peak") {
    planHeadline = "Save energy for the most valuable part of tomorrow.";
    customerReason =
      mode === "CHEAPEST"
        ? "Aveum is capturing cheaper energy now so more can be used or sold back during the highest-value period."
        : mode === "BALANCED"
        ? "Aveum will only export where the value is strong enough to justify it."
        : "Aveum is exporting only when clean surplus or high-value conditions line up.";
  } else if (noBatteryCharge) {
    planHeadline = "Hold steady overnight.";
    customerReason =
      mode === "BALANCED"
        ? "Battery reserve is already healthy, so extra charging would add little value tonight."
        : mode === "GREENEST"
        ? strongSolarExpected
          ? "Aveum is waiting for cleaner daytime and solar energy instead of charging overnight."
          : "Aveum is holding for cleaner periods before charging from the grid."
        : "Overnight prices do not create a strong enough saving opportunity to justify charging.";
  }

  const keyOutcomes = dedupe([
    hasEV && summary.evReadyBy && summary.evSlotsPlanned > 0 ? `EV ready by ${summary.evReadyBy}` : "",
    hasBattery && summary.batteryCyclesPlanned > 0 ? `Battery ready for the evening peak` : "",
    hasBattery && noBatteryCharge
      ? mode === "BALANCED"
        ? "Battery left untouched overnight"
        : mode === "GREENEST"
        ? "Battery waits for cleaner daytime energy"
        : "Battery stays steady overnight"
      : "",
    hasSolarPlan && selectedSolar ? `Solar picks up around ${selectedSolar.time}` : "",
    hasExport ? `Export planned around ${selectedExports[0].time}` : "",
    estimatedValue > 0 ? `Estimated value £${estimatedValue.toFixed(2)}` : "",
  ]).slice(0, 3);

  return {
    planHeadline,
    keyOutcomes,
    intent,
    customerReason,
    estimatedValue,
    showSolarInsight: hasSolarPlan,
    showPriceChart: summary.peakPrice - summary.cheapestPrice >= 6,
    showInsightCard:
      summary.mode === "CHEAPEST"
        ? summary.batteryCyclesPlanned > 0 || hasExport
        : summary.mode === "BALANCED"
        ? noBatteryCharge || hasExport
        : strongSolarExpected || noBatteryCharge,
  };
}

export function calculateProjectedBatteryArbitrage(
  cheapestPrice: number,
  peakPrice: number,
  batterySizeKwh = 10
) {
  return Number((((peakPrice - cheapestPrice) / 100) * batterySizeKwh).toFixed(2));
}

export function buildAveumPlan(
  rates: AgileRate[],
  connectedDeviceIds: ConnectedDeviceId[],
  solarForecastKwh = 18.4,
  mode: OptimisationMode = "CHEAPEST",
  options: AveumPlanOptions = {}
): { plan: PlanWithSessions; summary: PlanSummary; gridlySummary: AveumPlanSummary } {
  if (!rates.length) {
    const emptyPlan = [] as PlanWithSessions;
    emptyPlan.sessions = [];

    return {
      plan: emptyPlan,
      summary: {
        projectedEarnings: 0,
        projectedSavings: 0,
        cheapestSlot: "--:--",
        cheapestPrice: 0,
        peakSlot: "--:--",
        peakPrice: 0,
        mode,
        batteryReserveTargetPct: 0,
        batteryReserveStartPct: 0,
        batteryCyclesPlanned: 0,
        evSlotsPlanned: 0,
        estimatedImportSpend: 0,
        estimatedExportRevenue: 0,
        rationale: ["No pricing slots available yet."],
      },
      gridlySummary: {
        planHeadline: "Waiting for pricing data.",
        keyOutcomes: [],
        intent: "avoid_peak_import",
        customerReason: "Aveum needs pricing data before it can build a confident plan.",
        estimatedValue: 0,
        showSolarInsight: false,
        showPriceChart: false,
        showInsightCard: true,
      },
    };
  }

  const hasBattery = connectedDeviceIds.includes("battery");
  const hasEV = connectedDeviceIds.includes("ev");
  const hasSolar = connectedDeviceIds.includes("solar");
  const hasGrid = connectedDeviceIds.includes("grid");
  const tuning = MODE_TUNING[mode];

  const batteryCapacityKwh = options.batteryCapacityKwh ?? 10;
  const batteryStartPct = clamp(options.batteryStartPct ?? 58, 0, 100);
  const reserveTargetPct = clamp(options.batteryReservePct ?? tuning.reservePct, 5, 70);
  const maxBatteryCycles = Math.max(1, options.maxBatteryCyclesPerDay ?? tuning.maxBatteryCycles);
  const evReadyBy = options.evReadyBy ?? tuning.evReadyBy;
  const evTargetKwh = clamp(options.evTargetKwh ?? 14, 4, 40);
  const exportPriceRatio = clamp(options.exportPriceRatio ?? 0.72, 0.4, 1);

  const sortedByPrice = [...rates].sort((a, b) => a.pence - b.pence);
  const cheapest = sortedByPrice[0];
  const peak = sortedByPrice[sortedByPrice.length - 1];
  const normalizedSlots = buildNormalizedSlots(rates, solarForecastKwh, options.carbonIntensity, exportPriceRatio);
  const strongSolarExpected = hasSolar && solarForecastKwh >= 14;
  const importMedian = [...rates].sort((a, b) => a.pence - b.pence)[Math.floor(rates.length / 2)]?.pence ?? cheapest.pence;
  const reserveKwhNeeded = Math.max(0, ((reserveTargetPct - batteryStartPct) / 100) * batteryCapacityKwh);
  const kwhPerBatteryWindow = Math.max(1.8, Number((batteryCapacityKwh * 0.12).toFixed(2)));
  const reserveSlotsNeeded = hasBattery ? Math.ceil(reserveKwhNeeded / kwhPerBatteryWindow) : 0;
  const overnightSlots = normalizedSlots.filter((slot) => slot.slotIndex <= 13 || slot.slotIndex >= 40);

  const priceFirstCandidates = [...overnightSlots]
    .map((slot) => ({
      ...slot,
      planScore: (1 - slot.normalizedImport) * 0.82 + slot.normalizedExport * 0.18,
    }))
    .sort((a, b) => b.planScore - a.planScore);

  const compromiseCandidates = normalizedSlots
    .filter((slot) => slot.importPence <= importMedian + 4)
    .map((slot) => ({
      ...slot,
      planScore: (1 - slot.normalizedImport) * 0.5 + (1 - slot.normalizedCarbon) * 0.35 + slot.normalizedSolar * 0.15,
    }))
    .sort((a, b) => b.planScore - a.planScore);

  const greenCandidates = normalizedSlots
    .map((slot) => ({
      ...slot,
      planScore: (1 - slot.normalizedCarbon) * 0.72 + slot.normalizedSolar * 0.2 + (1 - slot.normalizedImport) * 0.08,
    }))
    .sort((a, b) => b.planScore - a.planScore);

  let batteryWindowsTarget = 0;
  let batteryChargeCandidates: Array<NormalizedSlot & { planScore: number }> = [];

  if (hasBattery) {
    if (mode === "CHEAPEST") {
      batteryWindowsTarget = clamp(Math.max(2, reserveSlotsNeeded + 1), 1, maxBatteryCycles + 1);
      batteryChargeCandidates = priceFirstCandidates;
    } else if (mode === "BALANCED") {
      const needsTopUp = batteryStartPct < reserveTargetPct + 6;
      batteryWindowsTarget = needsTopUp ? clamp(Math.max(1, reserveSlotsNeeded), 1, maxBatteryCycles) : 0;
      batteryChargeCandidates = compromiseCandidates;
    } else {
      const needsSafetyTopUp = batteryStartPct < reserveTargetPct;
      batteryWindowsTarget = strongSolarExpected ? 0 : needsSafetyTopUp ? 1 : 0;
      batteryChargeCandidates = greenCandidates;
    }
  }

  const selectedBatteryCharges = batteryWindowsTarget > 0
    ? selectWithGap(batteryChargeCandidates, batteryWindowsTarget, tuning.minGapSlotsBetweenChargeWindows)
    : [];

  const deadlineIndex = parseSlotIndex(evReadyBy);
  const evWindow = normalizedSlots.filter((slot) => slot.slotIndex <= deadlineIndex);
  const evSlotKwh = 3.6;
  const evSlotsNeeded = hasEV ? Math.max(1, Math.ceil(evTargetKwh / evSlotKwh)) : 0;
  const occupiedBatterySlots = new Set(selectedBatteryCharges.map((slot) => slot.slotIndex));
  const evCandidatePool = evWindow.filter((slot) => !occupiedBatterySlots.has(slot.slotIndex));

  let selectedEvCharges: NormalizedSlot[] = [];
  if (hasEV) {
    if (mode === "CHEAPEST") {
      selectedEvCharges = [...evCandidatePool]
        .sort((a, b) => a.importPence - b.importPence)
        .slice(0, evSlotsNeeded)
        .sort((a, b) => a.slotIndex - b.slotIndex);
    } else if (mode === "BALANCED") {
      const balancedEvRanked = [...evCandidatePool]
        .map((slot) => ({
          ...slot,
          evScore: (1 - slot.normalizedImport) * 0.6 + (1 - slot.normalizedCarbon) * 0.4,
        }))
        .sort((a, b) => b.evScore - a.evScore);
      selectedEvCharges = selectBestConsecutiveBlock(
        balancedEvRanked,
        evSlotsNeeded,
        (slot) => slot.evScore
      ).sort((a, b) => a.slotIndex - b.slotIndex);
    } else {
      const priceGuard = average(evCandidatePool.map((slot) => slot.importPence)) + 5;
      selectedEvCharges = [...evCandidatePool]
        .filter((slot) => slot.importPence <= priceGuard)
        .sort((a, b) => a.carbonIntensity - b.carbonIntensity)
        .slice(0, evSlotsNeeded)
        .sort((a, b) => a.slotIndex - b.slotIndex);
      if (selectedEvCharges.length < evSlotsNeeded) {
        const fallback = [...evCandidatePool]
          .sort((a, b) => a.carbonIntensity - b.carbonIntensity)
          .slice(0, evSlotsNeeded)
          .sort((a, b) => a.slotIndex - b.slotIndex);
        selectedEvCharges = fallback;
      }
    }
  }

  const occupiedSlots = new Set([
    ...selectedBatteryCharges.map((slot) => slot.slotIndex),
    ...selectedEvCharges.map((slot) => slot.slotIndex),
  ]);

  const exportCandidates = normalizedSlots
    .filter((slot) => !occupiedSlots.has(slot.slotIndex))
    .map((slot) => {
      const exportValue = slot.normalizedExport * tuning.exportWeight;
      const greenValue = slot.normalizedSolar * (mode === "GREENEST" ? tuning.greenWeight : 0.08);
      return {
        ...slot,
        planScore: exportValue + greenValue,
      };
    })
    .sort((a, b) => b.planScore - a.planScore);

  let selectedExports: Array<NormalizedSlot & { planScore: number }> = [];
  if (hasGrid && (hasBattery || hasSolar)) {
    if (mode === "CHEAPEST") {
      selectedExports = exportCandidates.slice(0, 2);
    } else if (mode === "BALANCED") {
      const best = exportCandidates[0];
      const avgChargePence = average(selectedBatteryCharges.map((slot) => slot.importPence));
      const spread = best ? best.exportPence - (avgChargePence || cheapest.pence) : 0;
      selectedExports = best && spread >= 8 ? [best] : [];
    } else {
      const best = exportCandidates[0];
      const highExportThreshold = peak.pence * exportPriceRatio * 0.85;
      const allowGreenExport = strongSolarExpected || batteryStartPct > reserveTargetPct + 10;
      selectedExports = best && allowGreenExport && best.exportPence >= highExportThreshold ? [best] : [];
    }
  }

  const solarCandidates = normalizedSlots
    .filter((slot) => !occupiedSlots.has(slot.slotIndex))
    .sort((a, b) => b.solarPotentialKwh - a.solarPotentialKwh);

  let selectedSolar: NormalizedSlot | undefined;
  if (hasSolar) {
    if (mode === "CHEAPEST") {
      selectedSolar = solarForecastKwh >= 18 ? solarCandidates[0] : undefined;
    } else if (mode === "BALANCED") {
      selectedSolar = solarForecastKwh >= 10 ? solarCandidates[0] : undefined;
    } else {
      selectedSolar = solarForecastKwh >= 8 ? solarCandidates[0] : undefined;
    }
  }

  const holdCandidates = normalizedSlots.filter(
    (slot) => !occupiedSlots.has(slot.slotIndex) && !selectedExports.some((exp) => exp.slotIndex === slot.slotIndex)
  );
  const holdSlot = [...holdCandidates].sort((a, b) => Math.abs(a.normalizedImport - 0.5) - Math.abs(b.normalizedImport - 0.5))[0] ?? normalizedSlots[0];

  const decisions: SlotDecision[] = [];

  for (const slot of selectedBatteryCharges) {
    decisions.push({
      slotIndex: slot.slotIndex,
      time: slot.time,
      decisionType: "battery_charge",
      action: "CHARGE",
      score: slot.planScore,
      reason:
        mode === "CHEAPEST"
          ? `Selected as a lowest-cost import window (${slot.importPence.toFixed(1)}p) to maximise arbitrage upside.`
          : mode === "BALANCED"
          ? `Adds a controlled top-up at ${slot.importPence.toFixed(1)}p while preserving reserve and limiting battery wear.`
          : `Only charges from grid when needed for safety reserve (${reserveTargetPct}%), favouring cleaner slots (${slot.carbonIntensity}gCO₂).`,
      importPence: slot.importPence,
      exportPence: slot.exportPence,
      requires: ["battery"],
      title: mode === "GREENEST" ? "Safety reserve top-up" : "Charging your battery",
    });
  }

  for (const slot of selectedEvCharges) {
    decisions.push({
      slotIndex: slot.slotIndex,
      time: slot.time,
      decisionType: "ev_charge",
      action: "CHARGE",
      score:
        mode === "GREENEST"
          ? (1 - slot.normalizedCarbon)
          : mode === "BALANCED"
          ? (1 - slot.normalizedImport) * 0.6 + (1 - slot.normalizedCarbon) * 0.4
          : (1 - slot.normalizedImport),
      reason:
        mode === "CHEAPEST"
          ? `Picks one of the cheapest available EV slots (${slot.importPence.toFixed(1)}p) before ${evReadyBy}.`
          : mode === "BALANCED"
          ? `Schedules EV charging before ${evReadyBy} with a cost/carbon compromise (${slot.importPence.toFixed(1)}p, ${slot.carbonIntensity}gCO₂).`
          : `Prefers lower-carbon charging before ${evReadyBy} (${slot.carbonIntensity}gCO₂), accepting non-minimum price when needed.`,
      importPence: slot.importPence,
      exportPence: slot.exportPence,
      requires: ["ev"],
      title: mode === "GREENEST" ? "Lower-carbon EV charging" : "Charging your EV",
    });
  }

  for (const selectedExport of selectedExports) {
    decisions.push({
      slotIndex: selectedExport.slotIndex,
      time: selectedExport.time,
      decisionType: "export",
      action: "EXPORT",
      score: selectedExport.planScore,
      reason:
        mode === "CHEAPEST"
          ? `Exports in a premium window (${selectedExport.exportPence.toFixed(1)}p) to monetise low-cost charging.`
          : mode === "BALANCED"
          ? `Exports only where spread is strong enough to justify battery cycling (${selectedExport.exportPence.toFixed(1)}p).`
          : `Exports only when clean surplus or high-value conditions are present (${selectedExport.exportPence.toFixed(1)}p).`,
      importPence: selectedExport.importPence,
      exportPence: selectedExport.exportPence,
      requires: hasGrid ? ["battery", "grid"] : ["battery"],
      title: hasGrid ? "Selling to the grid" : "Avoiding peak imports",
    });
  }

  if (selectedSolar) {
    decisions.push({
      slotIndex: selectedSolar.slotIndex,
      time: selectedSolar.time,
      decisionType: "solar",
      action: "SOLAR",
      score: selectedSolar.normalizedSolar,
      reason:
        mode === "GREENEST"
          ? `Prioritises forecast solar peak around ${selectedSolar.time} (${selectedSolar.solarPotentialKwh.toFixed(2)}kWh), deferring grid imports where possible.`
          : `Uses forecast solar around ${selectedSolar.time} (${selectedSolar.solarPotentialKwh.toFixed(2)}kWh) to offset imports.`,
      importPence: selectedSolar.importPence,
      exportPence: selectedSolar.exportPence,
      requires: ["solar"],
      title: "Solar powering your home",
    });
  }

  decisions.push({
    slotIndex: holdSlot.slotIndex,
    time: holdSlot.time,
    decisionType: "hold",
    action: "HOLD",
    score: 0.5,
    reason:
      mode === "CHEAPEST"
        ? `Waits outside top-value windows to keep actions concentrated on the strongest savings slots.`
        : mode === "BALANCED"
        ? `Deliberate hold to reduce unnecessary cycling and preserve flexibility.`
        : `Delays discretionary import until cleaner generation windows are available.`,
    importPence: holdSlot.importPence,
    exportPence: holdSlot.exportPence,
    requires: [],
    title: "Resting overnight",
  });

  const planSlots = decisions
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((decision) => decisionToPlanSlot(decision, mode));
  const sessions = buildPlanSessions(decisions, mode);
  const plan = planSlots as PlanWithSessions;
  plan.sessions = sessions;

  const importSpend = Number((
    decisions
      .filter((decision) => decision.action === "CHARGE")
      .reduce((total, decision) => total + (decision.importPence / 100), 0)
  ).toFixed(2));

  const exportRevenue = Number((
    decisions
      .filter((decision) => decision.action === "EXPORT")
      .reduce((total, decision) => total + (decision.exportPence / 100) * 4, 0)
  ).toFixed(2));

  const bestExportPrice = selectedExports.length
    ? Math.max(...selectedExports.map((slot) => slot.importPence))
    : peak.pence;
  const batteryChargePrice = selectedBatteryCharges[0]?.importPence ?? cheapest.pence;
  const projectedBatterySavings = hasBattery && selectedExports.length
    ? calculateProjectedBatteryArbitrage(batteryChargePrice, bestExportPrice, Math.min(6, batteryCapacityKwh * 0.6))
    : 0;

  const evPlanCost = selectedEvCharges.reduce((total, slot) => total + (slot.importPence / 100) * evSlotKwh, 0);
  const evBaselineRate = evWindow.length
    ? evWindow.reduce((total, slot) => total + slot.importPence, 0) / evWindow.length
    : cheapest.pence;
  const evBaselineCost = (evBaselineRate / 100) * evSlotKwh * selectedEvCharges.length;
  const evSavings = hasEV ? Math.max(0, evBaselineCost - evPlanCost) : 0;

  const modeSavingsFactor = mode === "CHEAPEST" ? 1 : mode === "BALANCED" ? 0.88 : 0.76;
  const projectedSavings = Number(((projectedBatterySavings + evSavings) * modeSavingsFactor).toFixed(2));
  const projectedEarnings = Number(exportRevenue.toFixed(2));

  const rationale: string[] = [
    `${mode} mode weights import ${Math.round(tuning.importWeight * 100)}%, export ${Math.round(tuning.exportWeight * 100)}%, and green signals ${Math.round(tuning.greenWeight * 100)}%.`,
    mode === "CHEAPEST"
      ? `Cheapest mode actively pursues low-cost import windows and stronger export arbitrage.`
      : mode === "BALANCED"
      ? `Balanced mode trims unnecessary charging/discharging and keeps a higher reserve.`
      : `Greenest mode prefers solar and low-carbon windows, deferring grid charging when solar is strong.`,
    `Battery reserve target is ${reserveTargetPct}% with up to ${maxBatteryCycles} charge window${maxBatteryCycles > 1 ? "s" : ""} to reduce wear.`,
  ];

  if (hasEV) {
    rationale.push(`EV charging is scheduled into ${selectedEvCharges.length} slot${selectedEvCharges.length !== 1 ? "s" : ""} before ${evReadyBy}.`);
  }
  if (hasSolar) {
    rationale.push(`Solar forecast (${solarForecastKwh.toFixed(1)}kWh) is used to shift demand toward midday generation.`);
  }

  const summary: PlanSummary = {
      projectedEarnings,
      projectedSavings,
      cheapestSlot: cheapest.time,
      cheapestPrice: cheapest.pence,
      peakSlot: peak.time,
      peakPrice: peak.pence,
      mode,
      batteryReserveTargetPct: reserveTargetPct,
      batteryReserveStartPct: batteryStartPct,
      batteryCyclesPlanned: selectedBatteryCharges.length,
      evReadyBy: hasEV ? evReadyBy : undefined,
      evSlotsPlanned: selectedEvCharges.length,
      estimatedImportSpend: importSpend,
      estimatedExportRevenue: exportRevenue,
      rationale,
    };

  const gridlySummary = buildAveumCustomerSummary({
    mode,
    hasBattery,
    hasEV,
    hasSolar,
    strongSolarExpected,
    selectedSolar,
    selectedExports,
    selectedBatteryCharges,
    summary,
  });

  return {
    plan,
    summary,
    gridlySummary,
  };
}
