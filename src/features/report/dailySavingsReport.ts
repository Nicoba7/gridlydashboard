import type { OptimizerOutput } from "../../domain/optimizer";
import type { TariffSchedule } from "../../domain/tariff";

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

// ── Output ─────────────────────────────────────────────────────────────────────

export interface SlotTimePrice {
  /** Wall-clock time label, e.g. "02:30". */
  time: string;
  pricePencePerKwh: number;
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

  // ── One-liner ─────────────────────────────────────────────────────────────────
  const oneLiner = buildOneLiner({
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    evChargedAt,
    earnedFromExportPence,
  });

  // ── Nightly narrative ─────────────────────────────────────────────────────────
  const nightlyNarrative = buildNightlyNarrative({
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    evChargedAt,
    earnedFromExportPence,
    chargeCount: chargeDecisions.length,
    dischargeCount: dischargeDecisions.length,
    evSlotCount: evDecisions.length,
  });

  return {
    savedTodayPence,
    earnedFromExportPence,
    cheapestSlotUsed,
    evChargedAt,
    batteryDischargedAt,
    oneLiner,
    nightlyNarrative,
  };
}

// ── Sentence builders ──────────────────────────────────────────────────────────

interface OneLinerInput {
  savedTodayPence: number;
  cheapestSlotUsed: SlotTimePrice | null;
  batteryDischargedAt: SlotTimePrice | null;
  evChargedAt: SlotTimePrice | null;
  earnedFromExportPence: number;
}

function buildOneLiner(input: OneLinerInput): string {
  const { savedTodayPence, cheapestSlotUsed, batteryDischargedAt, evChargedAt, earnedFromExportPence } = input;

  const savingsPhrase =
    savedTodayPence > 0
      ? `saving you ${formatPounds(savedTodayPence)} today`
      : `with no net saving today`;

  if (cheapestSlotUsed && batteryDischargedAt) {
    return `Aveum charged your battery at ${formatPenceRate(cheapestSlotUsed.pricePencePerKwh)} and discharged at ${formatPenceRate(batteryDischargedAt.pricePencePerKwh)}, ${savingsPhrase}.`;
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
  evChargedAt: SlotTimePrice | null;
  earnedFromExportPence: number;
  chargeCount: number;
  dischargeCount: number;
  evSlotCount: number;
}

function buildNightlyNarrative(input: NarrativeInput): string {
  const {
    savedTodayPence,
    cheapestSlotUsed,
    batteryDischargedAt,
    evChargedAt,
    earnedFromExportPence,
    chargeCount,
    dischargeCount,
    evSlotCount,
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

  if (evChargedAt && evSlotCount > 0) {
    const slots = evSlotCount === 1 ? "1 slot" : `${evSlotCount} slots`;
    sentences.push(
      `Your EV was charged across ${slots} starting around ${evChargedAt.time} at an average of ${formatPenceRate(evChargedAt.pricePencePerKwh)}, timed to the cheapest available window before departure.`,
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
