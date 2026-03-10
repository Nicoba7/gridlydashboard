/**
 * Gridly Optimisation Engine v2
 * Lookahead decision making based on upcoming Agile prices,
 * battery state, EV state, solar forecast and time of day.
 */

// ── CONSTANTS ─────────────────────────────────────────────────────────────
const THRESHOLDS = {
  CHEAP: 10,        // p/kWh — definitely charge
  GOOD: 15,         // p/kWh — worth charging
  MID: 22,          // p/kWh — neutral
  EXPENSIVE: 28,    // p/kWh — consider exporting
  PEAK: 35,         // p/kWh — definitely export
  NEGATIVE: 0,      // p/kWh — free electricity, charge everything
};

const BATTERY = {
  MIN_RESERVE: 20,  // % — never discharge below this
  FULL: 90,         // % — consider full
  LOW: 25,          // % — needs charging
};

const EV = {
  TARGET: 80,       // % — default charge target
  MINIMUM: 20,      // % — needs charging urgently
};

// ── CORE ENGINE ───────────────────────────────────────────────────────────

/**
 * Main optimisation function
 * @param {Object} params
 * @param {Array} params.rates - Array of {from, to, pence} sorted ascending
 * @param {Object} params.battery - {pct, kwh, capKwh}
 * @param {Object} params.ev - {pct, kwh, capKwh, connected}
 * @param {Object} params.solar - {currentW, forecastTodayKwh, forecastPeakHour}
 * @returns {Object} decision
 */
export function optimise({ rates, battery, ev, solar }) {
  if (!rates || rates.length === 0) {
    return makeDecision("MONITORING", "Waiting for price data", "#6B7280", [], null);
  }

  const now = new Date();
  const current = getCurrentSlot(rates, now);
  if (!current) {
    return makeDecision("MONITORING", "No current price slot available", "#6B7280", [], null);
  }

  const upcoming = getUpcoming(rates, now, 8); // next 4 hours
  const analysis = analyseRates(current, upcoming);
  const solarActive = solar && solar.currentW > 200;
  const solarPeak = solar && isSolarPeakHour(solar.forecastPeakHour, now);

  // ── DECISION TREE ──────────────────────────────────────────────────────

  // 1. Negative price — charge everything free
  if (current.pence < THRESHOLDS.NEGATIVE) {
    return makeDecision(
      "CHARGE MAX",
      `Negative price (${fmt(current.pence)}p) — charging battery and EV for free`,
      "#16A34A",
      buildActions(true, ev.connected, false),
      current
    );
  }

  // 2. EV critically low — charge regardless
  if (ev.connected && ev.pct < EV.MINIMUM) {
    return makeDecision(
      "CHARGE EV",
      `EV critically low (${ev.pct}%) — charging now regardless of price`,
      "#EF4444",
      buildActions(false, true, false),
      current
    );
  }

  // 3. Currently cheap AND cheaper than upcoming — charge now
  if (current.pence < THRESHOLDS.CHEAP && analysis.currentIsCheapest) {
    const actions = buildActions(
      battery.pct < BATTERY.FULL,
      ev.connected && ev.pct < EV.TARGET,
      false
    );
    return makeDecision(
      "CHARGE NOW",
      `${fmt(current.pence)}p now — cheapest slot in next 4 hours. ${battery.pct < BATTERY.FULL ? "Filling battery." : ""} ${ev.connected && ev.pct < EV.TARGET ? "Charging EV." : ""}`.trim(),
      "#16A34A",
      actions,
      current
    );
  }

  // 4. Currently cheap but cheaper slot coming — wait for it
  if (current.pence < THRESHOLDS.GOOD && !analysis.currentIsCheapest && analysis.cheapestUpcoming) {
    const slot = analysis.cheapestUpcoming;
    const minsAway = Math.round((slot.from - now) / 60000);
    return makeDecision(
      "WAIT",
      `Cheaper slot coming at ${fmtTime(slot.from)} (${fmt(slot.pence)}p vs ${fmt(current.pence)}p now) — ${minsAway} mins away`,
      "#F59E0B",
      [],
      current
    );
  }

  // 5. Good rate — charge if battery or EV needs it
  if (current.pence < THRESHOLDS.GOOD) {
    if (battery.pct < BATTERY.LOW) {
      return makeDecision(
        "CHARGE BATTERY",
        `Good rate ${fmt(current.pence)}p and battery low (${battery.pct}%) — charging now`,
        "#22C55E",
        buildActions(true, false, false),
        current
      );
    }
    if (ev.connected && ev.pct < EV.TARGET) {
      return makeDecision(
        "CHARGE EV",
        `Good rate ${fmt(current.pence)}p — smart charging EV (${ev.pct}% → ${EV.TARGET}%)`,
        "#38BDF8",
        buildActions(false, true, false),
        current
      );
    }
  }

  // 6. Solar generating — prioritise self-consumption
  if (solarActive) {
    if (battery.pct < BATTERY.FULL) {
      return makeDecision(
        "STORING SOLAR",
        `${fmt(solar.currentW / 1000, 1)}kW solar generating — storing excess in battery`,
        "#F59E0B",
        buildActions(true, false, false),
        current
      );
    }
    if (ev.connected && ev.pct < EV.TARGET) {
      return makeDecision(
        "SOLAR TO EV",
        `Battery full — diverting ${fmt(solar.currentW / 1000, 1)}kW solar to EV`,
        "#38BDF8",
        buildActions(false, true, false),
        current
      );
    }
  }

  // 7. Peak price — export if battery has capacity
  if (current.pence > THRESHOLDS.EXPENSIVE && battery.pct > BATTERY.MIN_RESERVE + 20) {
    // Check if there's a cheaper slot coming to recharge
    if (analysis.cheapSlotComing) {
      return makeDecision(
        "EXPORT",
        `Peak price ${fmt(current.pence)}p — exporting battery. Cheap slot at ${fmtTime(analysis.cheapSlotComing.from)} to recharge`,
        "#F59E0B",
        buildActions(false, false, true),
        current
      );
    }
    if (battery.pct > 60) {
      return makeDecision(
        "EXPORT",
        `High price ${fmt(current.pence)}p — exporting to grid for maximum return`,
        "#F59E0B",
        buildActions(false, false, true),
        current
      );
    }
  }

  // 8. Cheap slot coming soon — hold and wait
  if (analysis.cheapSlotComing) {
    const slot = analysis.cheapSlotComing;
    const minsAway = Math.round((slot.from - now) / 60000);
    if (minsAway < 90) {
      return makeDecision(
        "HOLDING",
        `Cheap slot in ${minsAway} mins (${fmt(slot.pence)}p at ${fmtTime(slot.from)}) — holding to charge then`,
        "#6B7280",
        [],
        current
      );
    }
  }

  // 9. Solar peak coming — hold battery space for it
  if (!solarActive && solarPeak && battery.pct > 50) {
    return makeDecision(
      "HOLDING FOR SOLAR",
      `Solar peak expected soon — keeping battery space to store generation`,
      "#F59E0B",
      [],
      current
    );
  }

  // 10. Default — monitor
  return makeDecision(
    "MONITORING",
    `Price ${fmt(current.pence)}p — no action needed. Watching for opportunities`,
    "#6B7280",
    [],
    current
  );
}

// ── RATE ANALYSIS ─────────────────────────────────────────────────────────

function analyseRates(current, upcoming) {
  if (!upcoming.length) return { currentIsCheapest: true, cheapestUpcoming: null, cheapSlotComing: null };

  const cheapestUpcoming = upcoming.reduce((min, r) => r.pence < min.pence ? r : min, upcoming[0]);
  const currentIsCheapest = current.pence <= cheapestUpcoming.pence;
  const cheapSlotComing = upcoming.find(r => r.pence < THRESHOLDS.GOOD) || null;
  const avgUpcoming = upcoming.reduce((s, r) => s + r.pence, 0) / upcoming.length;

  return { currentIsCheapest, cheapestUpcoming, cheapSlotComing, avgUpcoming };
}

function getCurrentSlot(rates, now) {
  return rates.find(r => now >= r.from && now < r.to) || null;
}

function getUpcoming(rates, now, n) {
  return rates.filter(r => r.from > now).slice(0, n);
}

function isSolarPeakHour(peakHour, now) {
  if (!peakHour) return false;
  const h = now.getHours();
  return h >= peakHour - 2 && h <= peakHour + 2;
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function buildActions(chargeBattery, chargeEv, export_) {
  const actions = [];
  if (chargeBattery) actions.push({ type: "battery", command: "CHARGE", label: "Charging battery" });
  if (chargeEv) actions.push({ type: "ev", command: "CHARGE", label: "Charging EV" });
  if (export_) actions.push({ type: "battery", command: "EXPORT", label: "Exporting to grid" });
  return actions;
}

function makeDecision(action, reason, color, actions, currentSlot) {
  return {
    action,
    reason,
    color,
    actions,
    currentSlot,
    timestamp: new Date(),
    nextReview: new Date(Date.now() + 30 * 60 * 1000), // 30 min
  };
}

function fmt(n, d = 1) { return Number(n).toFixed(d); }
function fmtTime(date) {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ── EXPLANATION GENERATOR ─────────────────────────────────────────────────
// Generates a plain English explanation of why a decision was made

export function explainDecision(decision, rates, battery, ev) {
  if (!decision || !rates.length) return null;

  const now = new Date();
  const upcoming = getUpcoming(rates, now, 6);
  const lines = [];

  lines.push(`**Current price:** ${fmt(decision.currentSlot?.pence)}p/kWh`);

  if (upcoming.length) {
    const min = Math.min(...upcoming.map(r => r.pence));
    const max = Math.max(...upcoming.map(r => r.pence));
    lines.push(`**Next 3 hours:** ${fmt(min)}p – ${fmt(max)}p`);
  }

  lines.push(`**Battery:** ${battery.pct}% (${battery.kwh}kWh)`);
  if (ev.connected) lines.push(`**EV:** ${ev.pct}%`);
  lines.push(`**Decision:** ${decision.reason}`);

  return lines.join("\n");
}

// ── ANNUAL SAVINGS CALCULATOR ─────────────────────────────────────────────

export function calcAnnualSavings({ hasOctopus, hasGivEnergy, hasZappi }) {
  const streams = [];
  let total = 0;

  if (hasGivEnergy) {
    streams.push({ label: "Solar self-consumption", value: 420, active: true });
    streams.push({ label: "Battery arbitrage", value: 380, active: true });
    streams.push({ label: "Solar export income", value: 180, active: true });
  } else {
    streams.push({ label: "Solar self-consumption", value: 420, active: false, unlock: "GivEnergy" });
    streams.push({ label: "Battery arbitrage", value: 380, active: false, unlock: "GivEnergy" });
    streams.push({ label: "Solar export income", value: 180, active: false, unlock: "GivEnergy" });
  }

  if (hasZappi || hasOctopus) {
    streams.push({ label: "EV smart charging", value: 310, active: true });
  } else {
    streams.push({ label: "EV smart charging", value: 310, active: false, unlock: "Zappi or Octopus" });
  }

  streams.push({ label: "Demand Flexibility (Phase 2)", value: 110, active: false, unlock: "Coming soon" });

  total = streams.filter(s => s.active).reduce((sum, s) => sum + s.value, 0);

  return { streams, total, maximum: 1400 };
}
