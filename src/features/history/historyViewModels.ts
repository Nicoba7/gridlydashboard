import type { DeviceConfig } from "../../pages/SimplifiedDashboard";

export type HistoryDeviceKey = "solar" | "battery" | "ev" | "grid";

export type HistoryDay = {
  day: string;
  solar: number;
  battery: number;
  ev: number;
  grid: number;
};

export type ChargeSession = {
  date: string;
  startTime: string;
  endTime: string;
  kwh: number;
  cost: number;
  avgPence: number;
  carbonG: number;
};

export type DeviceBreakdownItem = {
  id: HistoryDeviceKey;
  name: string;
  color: string;
  historyColor: string;
  total: number;
  rawPct: number;
  pct: number;
  icon: DeviceConfig["icon"];
};

export type SmartMoment = {
  id: string;
  title: string;
  detail: string;
  type: "best-day" | "solar" | "battery" | "ev" | "streak" | "other";
};

export type HistoryViewModel = {
  values: number[];
  maxValue: number;
  weekTotal: number;
  weekSavings: number;
  weekEarnings: number;
  weeklyComparison: {
    deltaValue: number;
    deltaPercent?: number;
    explanations: string[];
  };
  dayExplanations: string[][];
  fallbackExplanation: string[];
  smartMoments: SmartMoment[];
  weeklyRecap: string;
  freeDays: number;
  activeColor: string;
  activeLabel: string;
  deviceBreakdown: DeviceBreakdownItem[];
  topDevice?: DeviceBreakdownItem;
  weeklySummaryText: string;
  allTimeDelivered: number;
  allTimeSince: string;
  allTimeEarned?: number;
  chargeSessionTotals: {
    totalKwh: number;
    totalCost: number;
    totalSessions: number;
  };
};

export function isHistoryDeviceKey(value: string): value is HistoryDeviceKey {
  return value === "solar" || value === "battery" || value === "ev" || value === "grid";
}

function round(value: number, decimals = 2) {
  const power = 10 ** decimals;
  return Math.round(value * power) / power;
}

function getDayTotal(day: HistoryDay) {
  return day.solar + day.battery + day.ev + day.grid;
}

function getDaySavings(day: HistoryDay) {
  return day.solar + day.battery + day.ev;
}

function getDayEarnings(day: HistoryDay) {
  return day.grid;
}

function getHistoryValueForKey(day: HistoryDay, key: HistoryDeviceKey) {
  return day[key];
}

type DayExplanationCandidate = {
  text: string;
  family: "solar" | "battery" | "ev" | "grid" | "consistency";
  score: number;
};

function parseClockToMinutes(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours < 0 || hours > 23 || mins < 0 || mins > 59) {
    return null;
  }
  return hours * 60 + mins;
}

function isOvernightTime(time: string) {
  const minutes = parseClockToMinutes(time);
  if (minutes === null) return false;
  return minutes >= 22 * 60 || minutes < 6 * 60;
}

function formatMoney(value: number) {
  return `£${value.toFixed(2)}`;
}

function formatPence(value: number) {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? String(Math.round(value)) : fixed;
}

function getWeekWindows(history: HistoryDay[]) {
  const currentWeek = history.slice(-7);
  const previousWeek = history.length >= 14 ? history.slice(-14, -7) : [];
  return {
    currentWeek,
    previousWeek,
    hasPreviousWeek: previousWeek.length === 7,
  };
}

function buildWeeklyComparison({
  currentWeek,
  previousWeek,
  hasPreviousWeek,
  activeDevice,
}: {
  currentWeek: HistoryDay[];
  previousWeek: HistoryDay[];
  hasPreviousWeek: boolean;
  activeDevice: "all" | HistoryDeviceKey;
}) {
  if (!hasPreviousWeek) {
    return {
      deltaValue: 0,
      explanations: [] as string[],
    };
  }

  const getWeekTotalForActive = (week: HistoryDay[]) => {
    if (activeDevice === "all") return week.reduce((sum, day) => sum + getDayTotal(day), 0);
    return week.reduce((sum, day) => sum + getHistoryValueForKey(day, activeDevice), 0);
  };

  const currentTotal = getWeekTotalForActive(currentWeek);
  const previousTotal = getWeekTotalForActive(previousWeek);
  const deltaValue = round(currentTotal - previousTotal, 2);
  const deltaPercent = previousTotal > 0 ? round(((currentTotal - previousTotal) / previousTotal) * 100, 1) : undefined;

  const keys: HistoryDeviceKey[] = ["solar", "battery", "ev", "grid"];
  const labels: Record<HistoryDeviceKey, string> = {
    solar: "Solar",
    battery: "Battery",
    ev: "EV charging",
    grid: "Grid export",
  };

  const contributions = keys.map((key) => {
    const currentValue = currentWeek.reduce((sum, day) => sum + day[key], 0);
    const previousValue = previousWeek.reduce((sum, day) => sum + day[key], 0);
    const change = round(currentValue - previousValue, 2);
    const absChange = Math.abs(change);
    return {
      key,
      label: labels[key],
      currentValue,
      previousValue,
      change,
      absChange,
    };
  });

  const sameDirection = contributions.filter((entry) =>
    deltaValue > 0 ? entry.change > 0 : deltaValue < 0 ? entry.change < 0 : false
  );

  const sortedDrivers = [...sameDirection].sort((a, b) => b.absChange - a.absChange);
  const absDelta = Math.abs(deltaValue);
  const explanations: string[] = [];

  if (absDelta >= 0.8 && sortedDrivers.length > 0) {
    const primary = sortedDrivers[0];
    const driverShare = absDelta > 0 ? primary.absChange / absDelta : 0;

    if (primary.absChange >= 0.7 && driverShare >= 0.35) {
      explanations.push(
        `${primary.label} drove most of the ${deltaValue > 0 ? "increase" : "decline"} this week.`
      );
    }

    const secondary = sortedDrivers[1];
    if (secondary && secondary.absChange >= 0.6) {
      explanations.push(
        `${secondary.label} ${deltaValue > 0 ? "also added more value than last week" : "also contributed less value than last week"}.`
      );
    }
  }

  if (explanations.length === 0 && activeDevice !== "all") {
    const selected = contributions.find((entry) => entry.key === activeDevice);
    if (selected) {
      if (selected.absChange >= 0.6) {
        explanations.push(
          `${selected.label} ${selected.change > 0 ? "added more value than last week" : "contributed less value than last week"}.`
        );
      } else {
        explanations.push(`${selected.label} was broadly similar week to week.`);
      }
    }
  }

  if (explanations.length === 0) {
    const battery = contributions.find((entry) => entry.key === "battery");
    if (battery && battery.currentValue >= 2 && battery.previousValue >= 2 && battery.absChange < 0.6) {
      explanations.push("Battery contribution remained supportive.");
    } else {
      explanations.push("Most contributions were similar week to week.");
    }
  }

  const finalExplanations = explanations.slice(0, 2);

  return {
    deltaValue,
    deltaPercent,
    explanations: finalExplanations,
  };
}

function buildDayExplanation({
  history,
  dayIndex,
  chargeSessions,
  deviceBreakdown,
  weekTotal,
  bestDayIndex,
}: {
  history: HistoryDay[];
  dayIndex: number;
  chargeSessions: ChargeSession[];
  deviceBreakdown: DeviceBreakdownItem[];
  weekTotal: number;
  bestDayIndex: number;
}) {
  if (!history.length || weekTotal <= 0 || dayIndex < 0 || dayIndex >= history.length) {
    return [] as string[];
  }

  const day = history[dayIndex];
  const dayTotal = getDayTotal(day);
  if (dayTotal <= 0) return [] as string[];

  const dayShareOfWeek = dayTotal / weekTotal;

  const candidates: DayExplanationCandidate[] = [];

  const dominantForDay = [
    { key: "solar" as const, value: day.solar },
    { key: "battery" as const, value: day.battery },
    { key: "ev" as const, value: day.ev },
    { key: "grid" as const, value: day.grid },
  ].sort((a, b) => b.value - a.value)[0];

  if (dominantForDay.value > 0) {
    const dominantShare = dominantForDay.value / dayTotal;
    if (dominantShare >= 0.45) {
      const textByDevice: Record<HistoryDeviceKey, string> = {
        solar: "Solar generated most of today’s value.",
        battery: "Battery added most of today’s value by shifting lower-cost energy.",
        ev: "EV charging delivered most of today’s value in lower-cost periods.",
        grid: "Grid export generated most of today’s value.",
      };
      candidates.push({
        text: textByDevice[dominantForDay.key],
        family: dominantForDay.key,
        score: dominantShare * 100 + dayShareOfWeek * 25,
      });
    }
  }

  if (dayIndex === bestDayIndex && history.length >= 2) {
    const ranked = history
      .map((dayItem) => getDayTotal(dayItem))
      .sort((a, b) => b - a);
    const top = ranked[0] ?? 0;
    const second = ranked[1] ?? 0;
    const leadShare = top > 0 ? (top - second) / top : 0;

    if (leadShare >= 0.15 && dayShareOfWeek >= 0.18) {
      candidates.push({
        text: "This was the strongest value day of the week.",
        family: "consistency",
        score: 70 + leadShare * 100,
      });
    }
  }

  const batteryShare = dayTotal > 0 ? day.battery / dayTotal : 0;
  if (day.battery >= 0.8 && batteryShare >= 0.28) {
    candidates.push({
      text: "Battery added value after charging in lower-cost overnight periods.",
      family: "battery",
      score: batteryShare * 100,
    });
  }

  const isToday = dayIndex === history.length - 1;
  const daySessionLabel = day.day;
  const sessionsForDay = chargeSessions.filter((session) => {
    if (isToday && session.date === "Today") return true;
    return session.date === daySessionLabel;
  });
  const overnightForDay = sessionsForDay.filter((session) => isOvernightTime(session.startTime));
  const lowCostForDay = sessionsForDay.filter((session) => session.avgPence <= 10);
  const overnightRatio = sessionsForDay.length > 0 ? overnightForDay.length / sessionsForDay.length : 0;
  const lowCostRatio = sessionsForDay.length > 0 ? lowCostForDay.length / sessionsForDay.length : 0;

  if (day.ev >= 0.6 && sessionsForDay.length > 0 && overnightRatio >= 0.6 && lowCostRatio >= 0.6) {
    candidates.push({
      text: "EV charging completed in a lower-cost overnight window.",
      family: "ev",
      score: 40 + overnightRatio * 40 + lowCostRatio * 40,
    });
  }

  const sortedDevices = [...deviceBreakdown]
    .filter((device) => device.total > 0)
    .sort((a, b) => b.total - a.total);

  const topDevice = sortedDevices[0];
  const secondDevice = sortedDevices[1];

  if (topDevice && topDevice.id === "solar") {
    const topShare = topDevice.total / weekTotal;
    const topLeadShare = (topDevice.total - (secondDevice?.total ?? 0)) / weekTotal;

    if (day.solar / dayTotal >= 0.3 && topShare >= 0.35 && topLeadShare >= 0.08) {
      candidates.push({
        text: "Solar remained the strongest value driver this week.",
        family: "solar",
        score: 35 + topShare * 60,
      });
    }
  }

  const picked: DayExplanationCandidate[] = [];
  const usedFamilies = new Set<DayExplanationCandidate["family"]>();

  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (usedFamilies.has(candidate.family)) continue;
    picked.push(candidate);
    usedFamilies.add(candidate.family);
    if (picked.length === 2) break;
  }

  return picked.map((item) => item.text);
}

function buildFallbackExplanation({
  activeDevice,
  deviceBreakdown,
  history,
  chargeSessions,
  weekTotal,
  freeDays,
}: {
  activeDevice: "all" | HistoryDeviceKey;
  deviceBreakdown: DeviceBreakdownItem[];
  history: HistoryDay[];
  chargeSessions: ChargeSession[];
  weekTotal: number;
  freeDays: number;
}) {
  if (!history.length || weekTotal <= 0) return [] as string[];

  const totalByDevice: Record<HistoryDeviceKey, number> = {
    solar: deviceBreakdown.find((item) => item.id === "solar")?.total ?? 0,
    battery: deviceBreakdown.find((item) => item.id === "battery")?.total ?? 0,
    ev: deviceBreakdown.find((item) => item.id === "ev")?.total ?? 0,
    grid: deviceBreakdown.find((item) => item.id === "grid")?.total ?? 0,
  };

  const shareByDevice: Record<HistoryDeviceKey, number> = {
    solar: totalByDevice.solar / weekTotal,
    battery: totalByDevice.battery / weekTotal,
    ev: totalByDevice.ev / weekTotal,
    grid: totalByDevice.grid / weekTotal,
  };

  if (activeDevice === "all") {
    const sorted = [...deviceBreakdown].sort((a, b) => b.total - a.total);
    const top = sorted[0];
    const second = sorted[1];

    if (top && second) {
      const lead = (top.total - second.total) / weekTotal;
      if (top.total / weekTotal >= 0.34 && lead >= 0.08) {
        if (top.id === "solar") return ["Solar delivered the largest share of value this week."];
        if (top.id === "battery") return ["Battery contributed steadily across the week."];
        if (top.id === "ev") return ["EV charging contributed a leading share of weekly value."];
        return ["Grid export was the strongest value source this week."];
      }
    }

    if (freeDays === history.length && history.length >= 7) {
      return ["Value remained positive across all seven days."];
    }

    return ["Value was spread across multiple systems this week."];
  }

  if (activeDevice === "solar") {
    if (shareByDevice.solar >= 0.2) {
      return ["Solar value was strongest on higher-generation days."];
    }
    return [] as string[];
  }

  if (activeDevice === "battery") {
    if (shareByDevice.battery >= 0.15 || totalByDevice.battery >= 3) {
      return ["Battery contributed steadily across the week."];
    }
    return [] as string[];
  }

  if (activeDevice === "ev") {
    const overnightSessions = chargeSessions.filter((session) => isOvernightTime(session.startTime));
    const lowCostSessions = chargeSessions.filter((session) => session.avgPence <= 10);
    const overnightRatio = chargeSessions.length > 0 ? overnightSessions.length / chargeSessions.length : 0;
    const lowCostRatio = chargeSessions.length > 0 ? lowCostSessions.length / chargeSessions.length : 0;

    if (totalByDevice.ev >= 2 && chargeSessions.length >= 3 && overnightRatio >= 0.6 && lowCostRatio >= 0.6) {
      return ["EV value came from lower-cost overnight charging."];
    }
    if (shareByDevice.ev >= 0.12) {
      return ["EV charging contributed steadily across the week."];
    }
    return [] as string[];
  }

  if (activeDevice === "grid") {
    if (shareByDevice.grid >= 0.08) {
      return ["Grid export added value in stronger export windows."];
    }
    return [] as string[];
  }

  return [] as string[];
}

type SmartMomentCandidate = {
  moment: SmartMoment;
  score: number;
  dayKey?: string;
  category: "day" | "device" | "session" | "streak" | "weekly";
};

function buildSmartMoments({
  history,
  chargeSessions,
  deviceBreakdown,
  weekTotal,
  freeDays,
}: {
  history: HistoryDay[];
  chargeSessions: ChargeSession[];
  deviceBreakdown: DeviceBreakdownItem[];
  weekTotal: number;
  freeDays: number;
}) {
  if (!history.length || weekTotal <= 0) return [] as SmartMoment[];

  const candidates: SmartMomentCandidate[] = [];

  const dayTotals = history.map((day, index) => ({
    index,
    day,
    total: getDayTotal(day),
  }));

  const rankedDays = [...dayTotals].sort((a, b) => b.total - a.total);
  const bestDay = rankedDays[0];
  const secondBestDay = rankedDays[1];

  if (bestDay && bestDay.total > 0) {
    const share = bestDay.total / weekTotal;
    const lead = secondBestDay ? (bestDay.total - secondBestDay.total) / bestDay.total : 1;
    if (share >= 0.16 && lead >= 0.08) {
      candidates.push({
        moment: {
          id: `best-day-${bestDay.day.day.toLowerCase()}`,
          title: "Best value day",
          detail: `${bestDay.day.day} delivered ${formatMoney(bestDay.total)}.`,
          type: "best-day",
        },
        score: 100 + share * 100 + lead * 100,
        dayKey: bestDay.day.day,
        category: "day",
      });
    }
  }

  const solarTotal = history.reduce((sum, day) => sum + day.solar, 0);
  const topSolarDay = [...history]
    .map((day) => ({ day, value: day.solar }))
    .sort((a, b) => b.value - a.value)[0];

  if (topSolarDay && solarTotal / weekTotal >= 0.2 && topSolarDay.value >= 1.3) {
    const overlapsBestDay = bestDay?.day.day === topSolarDay.day.day;
    if (overlapsBestDay) {
      candidates.push({
        moment: {
          id: "solar-weekly-share",
          title: "Top weekly contributor",
          detail: "Solar created the largest share of weekly value.",
          type: "solar",
        },
        score: 84 + (solarTotal / weekTotal) * 100,
        category: "weekly",
      });
    } else {
      candidates.push({
        moment: {
          id: `solar-${topSolarDay.day.day.toLowerCase()}`,
          title: "Strongest solar day",
          detail: `${topSolarDay.day.day} led the week for solar value.`,
          type: "solar",
        },
        score: 75 + (solarTotal / weekTotal) * 100,
        dayKey: topSolarDay.day.day,
        category: "device",
      });
    }
  }

  const batteryTotal = history.reduce((sum, day) => sum + day.battery, 0);
  const topBatteryDay = [...history]
    .map((day) => ({ day, value: day.battery }))
    .sort((a, b) => b.value - a.value)[0];

  if (topBatteryDay && batteryTotal / weekTotal >= 0.18 && topBatteryDay.value >= 1) {
    const overlapsBestDay = bestDay?.day.day === topBatteryDay.day.day;
    if (overlapsBestDay) {
      candidates.push({
        moment: {
          id: "battery-weekly-share",
          title: "Battery contribution",
          detail: "Battery added value across multiple days this week.",
          type: "battery",
        },
        score: 76 + (batteryTotal / weekTotal) * 100,
        category: "weekly",
      });
    } else {
      candidates.push({
        moment: {
          id: `battery-${topBatteryDay.day.day.toLowerCase()}`,
          title: "Battery peak day",
          detail: `Battery peaked on ${topBatteryDay.day.day}, shifting ${formatMoney(topBatteryDay.value)} of value.`,
          type: "battery",
        },
        score: 70 + (batteryTotal / weekTotal) * 100,
        dayKey: topBatteryDay.day.day,
        category: "device",
      });
    }
  }

  if (chargeSessions.length > 0) {
    const cheapestSession = [...chargeSessions].sort((a, b) => {
      if (a.avgPence !== b.avgPence) return a.avgPence - b.avgPence;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.kwh - b.kwh;
    })[0];

    const evTotal = deviceBreakdown.find((item) => item.id === "ev")?.total ?? 0;
    if (cheapestSession && evTotal >= 1 && cheapestSession.avgPence <= 10) {
      candidates.push({
        moment: {
          id: `ev-${cheapestSession.date.toLowerCase()}-${cheapestSession.startTime}`,
          title: "Cheapest EV session",
          detail: `${cheapestSession.date} ${cheapestSession.startTime}–${cheapestSession.endTime} at ${formatPence(cheapestSession.avgPence)}p/kWh.`,
          type: "ev",
        },
        score: 65 + Math.max(0, 10 - cheapestSession.avgPence) * 5,
        dayKey: cheapestSession.date,
        category: "session",
      });
    }
  }

  if (freeDays === history.length && history.length >= 7) {
    candidates.push({
      moment: {
        id: "streak-all-positive",
          title: "Positive all week",
          detail: `Aveum delivered positive value on all ${history.length} days.`,
        type: "streak",
      },
      score: 90,
      category: "streak",
    });
  }

  const selected: SmartMoment[] = [];
  const usedTypes = new Set<SmartMoment["type"]>();
  const usedCategories = new Set<SmartMomentCandidate["category"]>();
  const usedDayKeys = new Set<string>();
  const remaining = [...candidates];

  while (remaining.length > 0 && selected.length < 4) {
    let bestIndex = -1;
    let bestAdjustedScore = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (usedTypes.has(candidate.moment.type)) continue;

      let adjusted = candidate.score;

      if (candidate.dayKey && usedDayKeys.has(candidate.dayKey)) {
        adjusted -= 42;
      }

      if (usedCategories.has(candidate.category)) {
        adjusted -= 16;
      }

      if (candidate.category === "weekly" && candidate.dayKey === undefined) {
        adjusted += 8;
      }

      if (candidate.moment.type === "ev") {
        adjusted += 10;
      }

      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted;
        bestIndex = index;
      }
    }

    if (bestIndex < 0 || bestAdjustedScore < 55) break;

    const picked = remaining.splice(bestIndex, 1)[0];
    selected.push(picked.moment);
    usedTypes.add(picked.moment.type);
    usedCategories.add(picked.category);
    if (picked.dayKey) usedDayKeys.add(picked.dayKey);
  }

  if (selected.length < 2) return [] as SmartMoment[];
  return selected;
}

function toDisplayPercents(rawPercents: number[]) {
  if (!rawPercents.length) return [] as number[];

  const normalized = rawPercents.map((value) => Math.min(100, Math.max(0, value)));
  const floored = normalized.map((value) => Math.floor(value));
  const floorTotal = floored.reduce((sum, value) => sum + value, 0);
  const remainder = Math.max(0, 100 - floorTotal);

  const ranked = normalized
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
      value,
    }))
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      if (b.value !== a.value) return b.value - a.value;
      return a.index - b.index;
    });

  const display = [...floored];
  for (let i = 0; i < remainder && i < ranked.length; i += 1) {
    display[ranked[i].index] += 1;
  }

  return display.map((value) => Math.min(100, Math.max(0, value)));
}

export function buildHistoryViewModel({
  history,
  chargeSessions,
  connectedDevices,
  activeDevice,
  allTimeDelivered,
  allTimeSince,
  allTimeEarned,
}: {
  history: HistoryDay[];
  chargeSessions: ChargeSession[];
  connectedDevices: DeviceConfig[];
  activeDevice: "all" | HistoryDeviceKey;
  allTimeDelivered?: number;
  allTimeSince?: string;
  allTimeEarned?: number;
}): HistoryViewModel {
  const { currentWeek, previousWeek, hasPreviousWeek } = getWeekWindows(history);

  const values = currentWeek.map((day) => {
    if (activeDevice === "all") return getDayTotal(day);
    return getHistoryValueForKey(day, activeDevice);
  });

  const maxValue = Math.max(0, ...values);
  const weekTotal = round(values.reduce((sum, value) => sum + value, 0));
  const weeklyTotalValue = round(currentWeek.reduce((sum, day) => sum + getDayTotal(day), 0));
  const weekSavings = round(currentWeek.reduce((sum, day) => sum + getDaySavings(day), 0));
  const weekEarnings = round(currentWeek.reduce((sum, day) => sum + getDayEarnings(day), 0));
  const weeklyRecap = `Aveum delivered £${weekTotal.toFixed(2)} in value this week.`;
  const freeDays = currentWeek.filter((day) => getDayTotal(day) > 0).length;

  const activeColor =
    activeDevice === "all"
      ? "#22C55E"
      : connectedDevices.find((device) => device.id === activeDevice)?.historyColor ?? "#22C55E";

  const activeLabel =
    activeDevice === "all"
      ? "all devices"
      : connectedDevices.find((device) => device.id === activeDevice)?.name ?? "selected device";

  const totalForPct = weeklyTotalValue > 0 ? weeklyTotalValue : 1;

  const deviceRows = connectedDevices
    .filter((device): device is DeviceConfig & { id: HistoryDeviceKey } => isHistoryDeviceKey(device.id))
    .map((device) => {
      const total = round(currentWeek.reduce((sum, day) => sum + getHistoryValueForKey(day, device.id), 0));
      const rawPct = Math.min(100, Math.max(0, (total / totalForPct) * 100));
      return {
        id: device.id,
        name: device.name,
        color: device.color,
        historyColor: device.historyColor,
        total,
        rawPct,
        icon: device.icon,
      };
    });

  const displayPercents = toDisplayPercents(deviceRows.map((row) => row.rawPct));

  const deviceBreakdown: DeviceBreakdownItem[] = deviceRows.map((row, index) => ({
    ...row,
    pct: displayPercents[index] ?? 0,
  }));

  const topDevice = [...deviceBreakdown].sort((a, b) => b.total - a.total)[0];

  const bestDayIndex = currentWeek.reduce((bestIndex, day, dayIndex) => {
    const bestValue = getDayTotal(currentWeek[bestIndex]);
    const value = getDayTotal(day);
    return value > bestValue ? dayIndex : bestIndex;
  }, 0);

  const dayExplanations = currentWeek.map((_, dayIndex) =>
    buildDayExplanation({
      history: currentWeek,
      dayIndex,
      chargeSessions,
      deviceBreakdown,
      weekTotal,
      bestDayIndex,
    })
  );

  const fallbackExplanation = buildFallbackExplanation({
    activeDevice,
    deviceBreakdown,
    history: currentWeek,
    chargeSessions,
    weekTotal,
    freeDays,
  });

  const smartMoments = buildSmartMoments({
    history: currentWeek,
    chargeSessions,
    deviceBreakdown,
    weekTotal: weeklyTotalValue,
    freeDays,
  });

  const weeklyComparison = buildWeeklyComparison({
    currentWeek,
    previousWeek,
    hasPreviousWeek,
    activeDevice,
  });

  const weeklySummaryText =
    weekTotal > 0
      ? `This week Aveum delivered £${weekTotal.toFixed(2)} total value (£${weekSavings.toFixed(2)} savings + £${weekEarnings.toFixed(2)} earnings).`
      : "This week has no recorded Aveum value yet.";

  const chargeSessionTotals = {
    totalKwh: round(chargeSessions.reduce((sum, session) => sum + session.kwh, 0), 1),
    totalCost: round(chargeSessions.reduce((sum, session) => sum + session.cost, 0), 2),
    totalSessions: chargeSessions.length,
  };

  const computedAllTimeDelivered = round(history.reduce((sum, day) => sum + getDayTotal(day), 0));

  return {
    values,
    maxValue,
    weekTotal,
    weekSavings,
    weekEarnings,
    weeklyComparison,
    dayExplanations,
    fallbackExplanation,
    smartMoments,
    weeklyRecap,
    freeDays,
    activeColor,
    activeLabel,
    deviceBreakdown,
    topDevice,
    weeklySummaryText,
    allTimeDelivered: allTimeDelivered ?? computedAllTimeDelivered,
    allTimeSince: allTimeSince ?? "your first recorded day",
    allTimeEarned,
    chargeSessionTotals,
  };
}
