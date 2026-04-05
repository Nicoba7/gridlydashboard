import type { HeatPumpPreHeatEvent, OptimizerOutput } from "../../domain/optimizer";
import type { TariffSchedule } from "../../domain/tariff";

export type { HeatPumpPreHeatEvent };

// ── Input ──────────────────────────────────────────────────────────────────────

export interface DailySavingsReportInput {
  optimizerOutput: OptimizerOutput;
  tariffSchedule: TariffSchedule;
  /**
   * Estimated total net energy cost (import cost minus export revenue) for the
   * same day under a set-and-forget approach, in pence.
   *
   * This is used as the comparison baseline for savings calculation. Callers
   * can derive it from the optimizer summary of a no-action simulation, from
   * a benchmark baseline run, or from a historical average.
   */
  setAndForgetNetCostPence: number;
}

export interface SolarDivertEvent {
  destination: "EV" | "battery";
  divertedKwh: number;
  savedPence: number;
}

export interface PowerUpOvernightSummary {
  count: number;
  chargedKwh: number;
}

export interface SavingSessionOvernightSummary {
  participated: boolean;
  estimatedEarningPounds: number;
}

// ── Output ─────────────────────────────────────────────────────────────────────

export interface SlotTimePrice {
  /** Wall-clock time label, e.g. "02:30". */
  time: string;
  pricePencePerKwh: number;
}

export interface V2HDischargeEvent {
  timeRangeLabel: string;
  savedPence: number;
  chargeUsedPercent: number;
  remainingPercent: number;
}

export interface DailySavingsReport {
  /** Pence saved vs. set-and-forget. Positive = Aveum saved money. */
  savedTodayPence: number;
  /** Pence earned from exporting to the grid. */
  earnedFromExportPence: number;
  /** The cheapest import slot Aveum used to charge the battery, if any. */
  cheapestSlotUsed: SlotTimePrice | null;
  /**
   * The time and average import price of slots where the EV was charged.
   * Null when no EV charging was planned.
   */
  evChargedAt: SlotTimePrice | null;
  /**
   * The peak import price that Aveum avoided by discharging the battery.
   * Null when no battery discharge was planned.
   */
  batteryDischargedAt: SlotTimePrice | null;
  /**
   * Aggregated V2H discharge event when the EV powered the home.
   * Null when no V2H event was planned.
   */
  v2hDischargeEvent: V2HDischargeEvent | null;
  /**
   * Aggregated solar-divert event when surplus solar was routed to EV or battery.
   * Null when no divert event was planned.
   */
  solarDivertEvent?: SolarDivertEvent | null;
  /**
   * Optional overnight Octopus Power-Up summary injected by the cron pipeline.
   */
  powerUpOvernightSummary?: PowerUpOvernightSummary | null;
  /**
   * Optional overnight Saving Session participation summary injected by the cron pipeline.
   */
  savingSessionOvernightSummary?: SavingSessionOvernightSummary | null;
  /**
   * Heat pump pre-heat event scheduled during a cheap electricity window, if any.
   * Populated when a heat pump device is present and a pre-heat window was found.
   */
  heatPumpPreHeatEvent?: HeatPumpPreHeatEvent | null;
  /**
   * A single-sentence plain-English summary of what Aveum achieved today.
   * Example: "Aveum charged your battery at 2.3p and discharged at 34p, saving you £1.23 today."
   */
  oneLiner: string;
  /**
   * 3–4 sentence plain-English narrative explaining what Aveum did and why,
   * suitable for a nightly push notification or daily digest email.
   */
  nightlyNarrative: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatPounds(pence: number): string {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function formatPenceRate(pencePerKwh: number): string {
  return `${pencePerKwh.toFixed(1)}p`;
}

function formatCompactTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const period = hours >= 12 ? "pm" : "am";
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  if (minutes === 0) {
    return `${twelveHour}${period}`;
  }

  return `${twelveHour}:${String(minutes).padStart(2, "0")}${period}`;
}

/**
 * Returns the import rate (pence/kWh) for the tariff slot that covers
 * the given decision's startAt timestamp. Returns undefined when no slot matches.
 */
function importRateForSlot(
  startAt: string,
  tariffSchedule: TariffSchedule,
): number | undefined {
  const t = new Date(startAt).getTime();
  const rate = tariffSchedule.importRates.find((r) => {
    const start = new Date(r.startAt).getTime();
    const end = new Date(r.endAt).getTime();
    return t >= start && t < end;
  });
  return rate?.unitRatePencePerKwh;
}

// ── Core report builder ────────────────────────────────────────────────────────

export function buildDailySavingsReport(input: DailySavingsReportInput): DailySavingsReport {
  const { optimizerOutput, tariffSchedule, setAndForgetNetCostPence } = input;

  const avuemNetCostPence =
    optimizerOutput.summary.expectedImportCostPence -
    optimizerOutput.summary.expectedExportRevenuePence;

  const savedTodayPence = setAndForgetNetCostPence - avuemNetCostPence;
  const earnedFromExportPence = optimizerOutput.summary.expectedExportRevenuePence;

  // ── Cheapest charge slot ─────────────────────────────────────────────────────
  const chargeDecisions = optimizerOutput.decisions.filter(
    (d) => d.action === "charge_battery",
  );

  let cheapestSlotUsed: SlotTimePrice | null = null;
  if (chargeDecisions.length > 0) {
    let cheapestRate = Infinity;
    let cheapestStart = "";
    for (const d of chargeDecisions) {
      const rate = importRateForSlot(d.startAt, tariffSchedule);
      if (rate !== undefined && rate < cheapestRate) {
        cheapestRate = rate;
        cheapestStart = d.startAt;
      }
    }
    if (cheapestStart) {
      cheapestSlotUsed = { time: formatTime(cheapestStart), pricePencePerKwh: cheapestRate };
    }
  }

  // ── EV charging summary ──────────────────────────────────────────────────────
  const evDecisions = optimizerOutput.decisions.filter((d) => d.action === "charge_ev");

  let evChargedAt: SlotTimePrice | null = null;
  if (evDecisions.length > 0) {
    const rates = evDecisions
      .map((d) => importRateForSlot(d.startAt, tariffSchedule))
      .filter((r): r is number => r !== undefined);

    const avgPrice =
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : undefined;

    if (avgPrice !== undefined) {
      evChargedAt = {
        time: formatTime(evDecisions[0].startAt),
        pricePencePerKwh: Math.round(avgPrice * 10) / 10,
      };
    }
  }

  // ── Peak price avoided via discharge ────────────────────────────────────────
  const dischargeDecisions = optimizerOutput.decisions.filter(
    (d) => d.action === "discharge_battery",
  );

  let batteryDischargedAt: SlotTimePrice | null = null;
  if (dischargeDecisions.length > 0) {
    let peakRate = -Infinity;
    let peakStart = "";
    for (const d of dischargeDecisions) {
      const rate = importRateForSlot(d.startAt, tariffSchedule);
      if (rate !== undefined && rate > peakRate) {
        peakRate = rate;
        peakStart = d.startAt;
      }
    }
    if (peakStart) {
      batteryDischargedAt = { time: formatTime(peakStart), pricePencePerKwh: peakRate };
    }
  }

  const v2hDecisions = optimizerOutput.decisions.filter(
    (d) => d.action === "discharge_ev_to_home",
  );

  let v2hDischargeEvent: V2HDischargeEvent | null = null;
  if (v2hDecisions.length > 0) {
    const ordered = [...v2hDecisions].sort(
      (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
    );
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const savedPence = ordered.reduce((sum, decision) => {
      if (decision.expectedValuePence !== undefined) {
        return sum + decision.expectedValuePence;
      }

      const importRate = importRateForSlot(decision.startAt, tariffSchedule) ?? 0;
      return sum + ((decision.expectedEnergyTransferredKwh ?? 0) * importRate * 0.85);
    }, 0);
    const chargeUsedPercent = Math.max(
      0,
      (first.startingEvSocPercent ?? last.expectedEvSocPercent ?? 0) - (last.expectedEvSocPercent ?? first.startingEvSocPercent ?? 0),
    );

    v2hDischargeEvent = {
      timeRangeLabel: `${formatCompactTime(first.startAt)}-${formatCompactTime(last.endAt)}`,
      savedPence: Number(savedPence.toFixed(2)),
      chargeUsedPercent: Math.round(chargeUsedPercent),
      remainingPercent: Math.round(last.expectedEvSocPercent ?? first.startingEvSocPercent ?? 0),
    };
  }

  const solarDivertDecisions = optimizerOutput.decisions.filter(
    (d) => d.action === "divert_solar_to_ev" || d.action === "divert_solar_to_battery",
  );

  let solarDivertEvent: SolarDivertEvent | null = null;
  if (solarDivertDecisions.length > 0) {
    const divertedToEvKwh = solarDivertDecisions
      .filter((decision) => decision.action === "divert_solar_to_ev")
      .reduce((sum, decision) => sum + (decision.expectedEnergyTransferredKwh ?? 0), 0);
    const divertedToBatteryKwh = solarDivertDecisions
      .filter((decision) => decision.action === "divert_solar_to_battery")
      .reduce((sum, decision) => sum + (decision.expectedEnergyTransferredKwh ?? 0), 0);
    const divertedKwh = divertedToEvKwh + divertedToBatteryKwh;
    const savedPence = solarDivertDecisions.reduce((sum, decision) => {
      if (decision.expectedValuePence !== undefined) {
        return sum + decision.expectedValuePence;
      }

      const importRate = importRateForSlot(decision.startAt, tariffSchedule) ?? 0;
      return sum + ((decision.expectedEnergyTransferredKwh ?? 0) * importRate);
    }, 0);

    solarDivertEvent = {
      destination: divertedToEvKwh >= divertedToBatteryKwh ? "EV" : "battery",
      divertedKwh: Number(divertedKwh.toFixed(2)),
      savedPence: Number(savedPence.toFixed(2)),
    };
  }

  // ── One-liner ─────────────────────────────────────────────────────────────────
  const oneLiner = buildOneLiner({
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    v2hDischargeEvent,
    solarDivertEvent,
    evChargedAt,
    earnedFromExportPence,
  });

  // ── Nightly narrative ─────────────────────────────────────────────────────────
  const nightlyNarrative = buildNightlyNarrative({
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    v2hDischargeEvent,
    solarDivertEvent,
    evChargedAt,
    earnedFromExportPence,
    chargeCount: chargeDecisions.length,
    dischargeCount: dischargeDecisions.length,
    evSlotCount: evDecisions.length,
    heatPumpPreHeatEvent: optimizerOutput.heatPumpPreHeatEvent ?? null,
  });

  return {
    savedTodayPence,
    earnedFromExportPence,
    cheapestSlotUsed,
    evChargedAt,
    batteryDischargedAt,
    v2hDischargeEvent,
    solarDivertEvent,
    powerUpOvernightSummary: null,
    savingSessionOvernightSummary: null,
    heatPumpPreHeatEvent: optimizerOutput.heatPumpPreHeatEvent ?? null,
    oneLiner,
    nightlyNarrative,
  };
}

// ── Sentence builders ──────────────────────────────────────────────────────────

interface OneLinerInput {
  savedTodayPence: number;
  cheapestSlotUsed: SlotTimePrice | null;
  batteryDischargedAt: SlotTimePrice | null;
  v2hDischargeEvent: V2HDischargeEvent | null;
  solarDivertEvent: SolarDivertEvent | null;
  evChargedAt: SlotTimePrice | null;
  earnedFromExportPence: number;
}

function buildOneLiner(input: OneLinerInput): string {
  const { savedTodayPence, cheapestSlotUsed, batteryDischargedAt, v2hDischargeEvent, solarDivertEvent, evChargedAt, earnedFromExportPence } = input;

  const savingsPhrase =
    savedTodayPence > 0
      ? `saving you ${formatPounds(savedTodayPence)} today`
      : `with no net saving today`;

  if (cheapestSlotUsed && batteryDischargedAt) {
    return `Aveum charged your battery at ${formatPenceRate(cheapestSlotUsed.pricePencePerKwh)} and discharged at ${formatPenceRate(batteryDischargedAt.pricePencePerKwh)}, ${savingsPhrase}.`;
  }

  if (v2hDischargeEvent) {
    return `Aveum used your EV to power the home from ${v2hDischargeEvent.timeRangeLabel}, ${savingsPhrase}.`;
  }

  if (solarDivertEvent) {
    return `Aveum diverted ${solarDivertEvent.divertedKwh.toFixed(1)}kWh of surplus solar to your ${solarDivertEvent.destination}, ${savingsPhrase}.`;
  }

  if (cheapestSlotUsed && evChargedAt) {
    return `Aveum charged your battery and EV at ${formatPenceRate(cheapestSlotUsed.pricePencePerKwh)}, ${savingsPhrase}.`;
  }

  if (cheapestSlotUsed) {
    return `Aveum charged your battery at ${formatPenceRate(cheapestSlotUsed.pricePencePerKwh)}, ${savingsPhrase}.`;
  }

  if (earnedFromExportPence > 0) {
    return `Aveum exported solar surplus and earned ${formatPounds(earnedFromExportPence)}, ${savingsPhrase}.`;
  }

  if (savedTodayPence > 0) {
    return `Aveum optimised your energy use, ${savingsPhrase}.`;
  }

  return `Aveum is monitoring your home energy and looking for the next opportunity to save.`;
}

interface NarrativeInput {
  savedTodayPence: number;
  cheapestSlotUsed: SlotTimePrice | null;
  batteryDischargedAt: SlotTimePrice | null;
  v2hDischargeEvent: V2HDischargeEvent | null;
  solarDivertEvent: SolarDivertEvent | null;
  evChargedAt: SlotTimePrice | null;
  earnedFromExportPence: number;
  chargeCount: number;
  dischargeCount: number;
  evSlotCount: number;
  heatPumpPreHeatEvent?: HeatPumpPreHeatEvent | null;
}

function buildNightlyNarrative(input: NarrativeInput): string {
  const {
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    v2hDischargeEvent,
    solarDivertEvent,
    evChargedAt,
    earnedFromExportPence,
    chargeCount,
    dischargeCount,
    evSlotCount,
    heatPumpPreHeatEvent,
  } = input;

  const sentences: string[] = [];

  // Sentence 1: what Aveum did overnight (battery charge)
  if (cheapestSlotUsed && chargeCount > 0) {
    const slots = chargeCount === 1 ? "1 slot" : `${chargeCount} slots`;
    sentences.push(
      `Aveum charged your battery overnight across ${slots}, picking the cheapest electricity at ${formatPenceRate(cheapestSlotUsed.pricePencePerKwh)} at ${cheapestSlotUsed.time}.`,
    );
  } else {
    sentences.push(
      `Aveum monitored your home overnight and held the battery at its current level — no cheap charging window was available.`,
    );
  }

  // Sentence 2: discharge or EV action
  if (batteryDischargedAt && dischargeCount > 0) {
    const slots = dischargeCount === 1 ? "1 slot" : `${dischargeCount} slots`;
    sentences.push(
      `During the peak price period (up to ${formatPenceRate(batteryDischargedAt.pricePencePerKwh)}), Aveum discharged the battery across ${slots} to power your home from stored energy instead of the grid.`,
    );
  }

  if (v2hDischargeEvent) {
    sentences.push(
      `During ${v2hDischargeEvent.timeRangeLabel}, your EV powered the home, saving ${formatPounds(v2hDischargeEvent.savedPence)} while keeping ${v2hDischargeEvent.remainingPercent}% charge for tomorrow.`,
    );
  }

  if (solarDivertEvent) {
    sentences.push(
      `Aveum diverted ${solarDivertEvent.divertedKwh.toFixed(1)}kWh of surplus solar to your ${solarDivertEvent.destination}, avoiding around ${formatPounds(solarDivertEvent.savedPence)} of future grid charging.`,
    );
  }

  if (evChargedAt && evSlotCount > 0) {
    const slots = evSlotCount === 1 ? "1 slot" : `${evSlotCount} slots`;
    sentences.push(
      `Your EV was charged across ${slots} starting around ${evChargedAt.time} at an average of ${formatPenceRate(evChargedAt.pricePencePerKwh)}, timed to the cheapest available window before departure.`,
    );
  }

  // Heat pump pre-heat sentence
  if (heatPumpPreHeatEvent) {
    const hwNote = heatPumpPreHeatEvent.hotWaterSavingsPounds != null && heatPumpPreHeatEvent.hotWaterSavingsPounds > 0
      ? ` (including ~${formatPounds(heatPumpPreHeatEvent.hotWaterSavingsPounds * 100)} on the hot water cylinder)`
      : "";
    sentences.push(
      `Aveum pre-heated your home ${heatPumpPreHeatEvent.timeRangeLabel} at an effective heat cost of ${formatPenceRate(heatPumpPreHeatEvent.effectiveHeatCostPencePerKwh)} per kWh, saving around ${formatPounds(heatPumpPreHeatEvent.savedPence)}${hwNote} compared to heating at the peak rate.`,
    );
  }

  // Sentence 3: export revenue
  if (earnedFromExportPence > 1) {
    sentences.push(
      `Aveum also exported surplus solar to the grid, earning ${formatPounds(earnedFromExportPence)}.`,
    );
  }

  // Sentence 4: savings summary
  if (savedTodayPence > 0) {
    sentences.push(
      `In total, Aveum saved you ${formatPounds(savedTodayPence)} compared to leaving your system unmanaged today.`,
    );
  } else {
    sentences.push(
      `Prices were similar throughout the day, so Aveum focused on keeping your system ready for the next high-value opportunity.`,
    );
  }

  return sentences.join(" ");
}
