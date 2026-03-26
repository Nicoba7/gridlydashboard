import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SANDBOX, DeviceConfig } from "../pages/SimplifiedDashboard";
import type { CycleHeartbeatEntry, ExecutionJournalEntry } from "../journal/executionJournal";
import { ENERGY_COLORS } from "./energyColors";
import { DemoBadge } from "./FirstRunBanner";
import { buildLatestExecutionOutcomeDetailReadModel } from "../features/history/latestExecutionOutcomeDetailReadModel";
import { buildLatestOutcomeExpectationComparisonReadModel } from "../features/history/latestOutcomeExpectationComparisonReadModel";
import { buildRecentCycleHistoryReadModel } from "../features/history/recentCycleHistoryReadModel";
import { buildRecentExecutionOutcomesReadModel } from "../features/history/recentExecutionOutcomesReadModel";
import { buildRecentOutcomeCountersReadModel } from "../features/history/recentOutcomeCountersReadModel";
import {
  buildHistoryViewModel,
  isHistoryDeviceKey,
  type ChargeSession,
  type HistoryDay,
  type HistoryDeviceKey,
} from "../features/history/historyViewModels";

const ENABLE_HISTORY_SIMULATION = import.meta.env.DEV;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function buildLiveHistorySnapshot(now: Date, history: HistoryDay[], chargeSessions: ChargeSession[]) {
  if (!history.length) {
    return { history, chargeSessions };
  }

  const minuteOfDay = (now.getHours() * 60) + now.getMinutes();
  const dayProgress = clamp((minuteOfDay - 5 * 60) / (18 * 60), 0.18, 1);

  const liveHistory = history.map((day, index) => {
    const isToday = index === history.length - 1;
    if (!isToday) return day;

    const solar = Number((day.solar * dayProgress).toFixed(2));
    const battery = Number((day.battery * clamp(dayProgress + 0.04, 0.2, 1)).toFixed(2));
    const ev = Number((day.ev * clamp(dayProgress + 0.08, 0.2, 1)).toFixed(2));
    const grid = Number((day.grid * clamp(dayProgress, 0.2, 1)).toFixed(2));

    return {
      ...day,
      solar,
      battery,
      ev,
      grid,
    };
  });

  const nowMinutes = minuteOfDay;
  const liveSessions = chargeSessions
    .map((session) => {
      if (session.date !== "Today") return session;

      const start = toMinutes(session.startTime);
      const end = toMinutes(session.endTime);
      if (start === null || end === null) return session;

      const duration = Math.max(1, end - start);
      const elapsed = clamp(nowMinutes - start, 0, duration);
      const progress = clamp(elapsed / duration, 0, 1);

      if (progress <= 0) return null;

      return {
        ...session,
        kwh: Number((session.kwh * progress).toFixed(1)),
        cost: Number((session.cost * progress).toFixed(2)),
        carbonG: Math.round(session.carbonG * progress),
      };
    })
    .filter((session): session is ChargeSession => session !== null);

  return {
    history: liveHistory,
    chargeSessions: liveSessions,
  };
}

function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "16px 20px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 550, color: "#8795AA", letterSpacing: 0.18 }}>{label}</span>
        {open ? <ChevronUp size={14} color="#445066" strokeWidth={2.2} /> : <ChevronDown size={14} color="#445066" strokeWidth={2.2} />}
      </button>
      {open && <div style={{ paddingBottom: 10 }}>{children}</div>}
    </div>
  );
}

function DeliveredHeroCard({
  weekTotal,
  weekSavings,
  weekEarnings,
  freeDays,
  allTimeDelivered,
  allTimeSince,
  allTimeEarned,
  todayValue,
  todayTopDevice,
}: {
  weekTotal: number;
  weekSavings: number;
  weekEarnings: number;
  freeDays: number;
  allTimeDelivered: number;
  allTimeSince: string;
  allTimeEarned?: number;
  todayValue?: number;
  todayTopDevice?: "solar" | "battery" | "ev" | "grid" | null;
}) {
  return (
    <div className="mx-4 mt-5 overflow-hidden rounded-[20px] border border-[#182235] bg-[#0A111D] shadow-[0_14px_34px_rgba(1,7,20,0.32)]">
      <div style={{ height: 1, background: `linear-gradient(90deg, ${ENERGY_COLORS.battery}90, ${ENERGY_COLORS.battery}20)` }} />
      <div className="px-5 pb-5 pt-[18px]">
        <div className="mb-3 flex items-center gap-2">
          <div style={{ background: ENERGY_COLORS.battery, boxShadow: `0 0 8px ${ENERGY_COLORS.battery}95` }} className="h-[5px] w-[5px] rounded-full" />
          <span className="text-[10px] font-semibold tracking-[0.9px] text-[#566279]">PROVEN THIS WEEK</span>
        </div>

        <div className="mb-2 text-[28px] font-[820] leading-[1.1] tracking-[-0.8px] text-[#F3F7FF]">
          £{weekTotal.toFixed(2)} delivered
        </div>
        {todayValue != null && todayValue > 0 && (
          <div className="mb-1 text-[12px] font-semibold tracking-[-0.1px] text-[#4A8C5F]">
            +£{todayValue.toFixed(2)} today so far
          </div>
        )}
        {todayValue != null && todayValue > 0 && todayTopDevice && (
          <div className="mb-1 text-[11px] text-[#4E6275]">
            {todayTopDevice === "solar" && "Solar inverter covered most of today's value."}
            {todayTopDevice === "battery" && "Home battery provided most of today's value."}
            {todayTopDevice === "ev" && "EV charger contributed most of today's value."}
            {todayTopDevice === "grid" && "Smart meter captured most of today's value."}
          </div>
        )}

        <div className="mb-3 text-[12px] leading-[1.45] text-[#7C8BA2]">
          Value delivered through solar usage, battery timing, EV charging, and tariff optimisation.
        </div>

        <div className="mb-3 flex flex-col items-start gap-1">
          <span className="rounded-full border border-[#1B2A40] bg-[#0C1627] px-[7px] py-[2px] text-[10px] font-semibold tracking-[0.3px] text-[#95ABC6]">
            {freeDays}/7 days delivered positive value
          </span>
          <span className="text-[10px] text-[#697D96]">Consistent performance across the week</span>
        </div>

        <div className="flex items-end gap-4 border-t border-[#162235] pt-3 tabular-nums">
          <div className="min-w-[98px]">
            <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Saved by Aveum</div>
            <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#4ADE80] flex items-center">£{weekSavings.toFixed(2)}{isDemo && <DemoBadge />}</div>
          </div>
          <div className="min-w-[98px]">
            <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Earned by Aveum</div>
            <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#F5B942] flex items-center">£{weekEarnings.toFixed(2)}{isDemo && <DemoBadge />}</div>
          </div>
          <div className="ml-auto min-w-[80px] text-right">
            <div className="mb-[3px] text-[10px] font-semibold tracking-[0.45px] text-[#566279]">Total</div>
            <div className="text-[18px] font-extrabold tracking-[-0.4px] text-[#94A3B8] flex items-center justify-end">£{weekTotal.toFixed(2)}{isDemo && <DemoBadge />}</div>
          </div>
        </div>

        <div className="mt-3 text-[10.5px] text-[#667A93]">
          Tracking since {allTimeSince} · £{allTimeDelivered.toFixed(2)} all-time delivered
          {typeof allTimeEarned === "number" && allTimeEarned > 0 ? ` · £${allTimeEarned.toFixed(2)} earned` : ""}
        </div>
      </div>
    </div>
  );
}

function LatestCycleHeartbeatCard({ latestCycleHeartbeat }: { latestCycleHeartbeat?: CycleHeartbeatEntry }) {
  if (!latestCycleHeartbeat) {
    return null;
  }

  const caution = latestCycleHeartbeat.nextCycleExecutionCaution;
  const objectiveConfidence = latestCycleHeartbeat.householdObjectiveConfidence;

  if (!caution && !objectiveConfidence) {
    return null;
  }

  return (
    <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 18, border: "1px solid #152238", padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 10 }}>LAST RUN</div>
      {/* Shared canonical heartbeat truth, rendered minimally.
          This is a first step toward a fuller runtime/journal-backed History surface. */}
      <div style={{ display: "grid", gap: 4 }}>
        {caution && (
          <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
            {/* Presentation label only — canonical caution signal from runtime heartbeat */}
            <span style={{ color: "#4E5E75" }}>Status</span>&nbsp;&nbsp;{caution}
          </div>
        )}
        {objectiveConfidence && (
          <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
            {/* Presentation label only — canonical confidence signal from runtime heartbeat */}
            <span style={{ color: "#4E5E75" }}>Confidence</span>&nbsp;&nbsp;{objectiveConfidence}
          </div>
        )}
      </div>
    </div>
  );
}

function contributionExplanation(deviceId: HistoryDeviceKey) {
  if (deviceId === "solar") return "Covered daytime demand and reduced import reliance.";
  if (deviceId === "battery") return "Stored lower-cost energy and released it during higher-value periods.";
  if (deviceId === "ev") return "Shifted charging into lower-cost periods.";
  return "Captured value from dynamic import and export windows.";
}

function deviceDisplayName(deviceId: HistoryDeviceKey) {
  if (deviceId === "solar") return "Solar inverter";
  if (deviceId === "battery") return "Home battery";
  if (deviceId === "ev") return "EV charger";
  return "Smart meter";
}

function normalizeOutcomeStatusLabel(status: string): string {
  const trimmed = status.trim();
  if (/^failed$/i.test(trimmed)) {
    return "Not completed";
  }

  return trimmed;
}

function normalizeDeliveredOutcomeStatusLabel(status: string): string {
  const trimmed = status.trim();
  if (/^skipped$/i.test(trimmed)) {
    return "Not executed";
  }

  return normalizeOutcomeStatusLabel(trimmed);
}

function ValueContributionSection({
  deviceBreakdown,
  weekTotal,
}: {
  deviceBreakdown: ReturnType<typeof buildHistoryViewModel>["deviceBreakdown"];
  weekTotal: number;
}) {
  return (
    <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 20, border: "1px solid #152238", padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 12 }}>HOW VALUE WAS DELIVERED</div>
      <div style={{ display: "grid", gap: 10 }}>
        {deviceBreakdown.map((device, index) => {
          const pct = weekTotal > 0 ? Math.round((device.total / weekTotal) * 100) : 0;
          const Icon = device.icon;
          return (
            <div
              key={device.id}
              style={{
                display: "grid",
                gap: 5,
                paddingBottom: index < deviceBreakdown.length - 1 ? 10 : 0,
                borderBottom: index < deviceBreakdown.length - 1 ? "1px solid #111A2B" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon size={14} color={device.color} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#DCE6F5" }}>{deviceDisplayName(device.id)}</span>
                </div>
                <div style={{ fontSize: 13, color: device.color, fontWeight: 700 }}>£{device.total.toFixed(2)}</div>
              </div>
              <div style={{ fontSize: 11, color: "#8394AB", lineHeight: 1.4 }}>
                {contributionExplanation(device.id)} <span style={{ color: "#5F7088" }}>({pct}% of weekly value)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyMomentsSection({
  moments,
}: {
  moments: ReturnType<typeof buildHistoryViewModel>["smartMoments"];
}) {
  if (moments.length === 0) return null;

  return (
    <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 20, border: "1px solid #152238", padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 12 }}>PROVEN MOMENTS</div>
      {moments.slice(0, 4).map((moment, index) => (
        <div
          key={moment.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            paddingBottom: 12,
            marginBottom: index < Math.min(moments.length, 4) - 1 ? 12 : 0,
            borderBottom: index < Math.min(moments.length, 4) - 1 ? "1px solid #111A2B" : "none",
          }}
        >
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ADE80", marginTop: 7, boxShadow: "0 0 4px #4ADE80, 0 0 8px #4ADE8055" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 620, color: "#DCE6F5", marginBottom: 3 }}>{moment.title}</div>
            <div style={{ fontSize: 11.5, color: "#8EA0B8", lineHeight: 1.45 }}>{moment.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekAtGlanceSection({
  history,
  activeDevice,
  setActiveDevice,
  connectedDevices,
  values,
  maxVal,
  activeColor,
  weeklyNarrative,
  weekTotal,
  selectedDayIndex,
  setSelectedDayIndex,
  selectedDayExplanations,
}: {
  history: HistoryDay[];
  activeDevice: "all" | HistoryDeviceKey;
  setActiveDevice: (value: "all" | HistoryDeviceKey) => void;
  connectedDevices: DeviceConfig[];
  values: number[];
  maxVal: number;
  activeColor: string;
  weeklyNarrative: string;
  weekTotal: number;
  selectedDayIndex: number;
  setSelectedDayIndex: (index: number) => void;
  selectedDayExplanations: string[];
}) {
  const resolvedIndex = history.length === 0 ? 0 : Math.min(Math.max(0, selectedDayIndex), history.length - 1);
  const selectedDay = history[resolvedIndex];
  const selectedValue = values[resolvedIndex] ?? 0;

  return (
    <div style={{ margin: "12px 16px 0", background: "#09101A", borderRadius: 18, border: "1px solid #172236", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1 }}>WEEKLY PROOF</div>
        <div style={{ fontSize: 10.5, color: "#74869E" }}>£{weekTotal.toFixed(2)} total</div>
      </div>

      <div style={{ fontSize: 11, color: "#7E90A9", lineHeight: 1.45, marginBottom: 10 }}>
        £{weekTotal.toFixed(2)} delivered across the week.
      </div>
      <div style={{ fontSize: 10.5, color: "#657990", lineHeight: 1.45, marginBottom: 12 }}>
        {weeklyNarrative}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setActiveDevice("all")}
          style={{
            padding: "4px 10px",
            borderRadius: 20,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 10.5,
            fontWeight: 700,
            background: activeDevice === "all" ? "#172438" : "#101927",
            color: activeDevice === "all" ? "#C8D8EB" : "#6E7F97",
          }}
        >
          All
        </button>

        {connectedDevices
          .filter((device): device is DeviceConfig & { id: HistoryDeviceKey } => isHistoryDeviceKey(device.id))
          .map((device) => (
            <button
              key={device.id}
              onClick={() => setActiveDevice(device.id)}
              style={{
                padding: "4px 10px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 10.5,
                fontWeight: 700,
                background: activeDevice === device.id ? "#172438" : "#101927",
                color: activeDevice === device.id ? "#C8D8EB" : "#6E7F97",
              }}
            >
              {device.name.split(" ")[0]}
            </button>
          ))}
      </div>

      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 44, marginBottom: 4 }}>
        {history.map((day, i) => {
          const val = values[i] ?? 0;
          const h = Math.max(2, maxVal > 0 ? (val / maxVal) * 44 : 2);
          const isSelected = i === resolvedIndex;
          return (
            <button
              key={day.day}
              onClick={() => setSelectedDayIndex(i)}
              title={`${day.day}: £${val.toFixed(2)}`}
              style={{
                flex: 1,
                height: h,
                background: isSelected ? activeColor : `${activeColor}33`,
                border: "none",
                borderRadius: "2px 2px 0 0",
                cursor: "pointer",
                padding: 0,
              }}
              aria-label={`Select ${day.day}`}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {history.map((day, i) => (
          <div key={`${day.day}-label`} style={{ flex: 1, fontSize: 9, textAlign: "center", color: i === resolvedIndex ? "#AFC3DD" : "#41516A" }}>
            {i === history.length - 1 ? "Today" : day.day}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, borderTop: "1px solid #162235", paddingTop: 10 }}>
        <div style={{ fontSize: 11.5, color: "#C8D8EB", fontWeight: 620, marginBottom: 7 }}>
          {selectedDay ? `${selectedDay.day} · £${selectedValue.toFixed(2)} delivered` : "Select a day to inspect delivered value."}
        </div>
        {selectedDayExplanations.length > 0 ? (
          <div style={{ display: "grid", gap: 4 }}>
            {selectedDayExplanations.map((line) => (
              <div key={line} style={{ fontSize: 10.5, color: "#70839B", lineHeight: 1.45 }}>• {line}</div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: "#70839B" }}>Aveum balanced demand and tariff windows automatically that day.</div>
        )}
      </div>
    </div>
  );
}

function SessionDetailsCard({ sessions }: { sessions: ChargeSession[] }) {
  const shown = sessions.slice(0, 4);
  const totalKwh = sessions.reduce((sum, session) => sum + session.kwh, 0).toFixed(1);
  const totalCost = sessions.reduce((sum, session) => sum + session.cost, 0).toFixed(2);

  return (
    <div style={{ margin: "0 20px 10px", background: "#0A111D", border: "1px solid #182235", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #182235", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10.5, color: "#7F91A9" }}>EV charging details · {totalKwh}kWh · £{totalCost}</div>
        <button
          onClick={() => {
            const csv = [
              "Date,Start,End,kWh,Cost (£),Avg (p/kWh),Carbon (gCO2)",
              ...sessions.map((s) => `${s.date},${s.startTime},${s.endTime},${s.kwh},${s.cost},${s.avgPence},${s.carbonG}`),
            ].join("\n");

            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "gridly-sessions.csv";
            a.click();
          }}
          style={{ background: "transparent", border: "1px solid #223044", borderRadius: 8, padding: "4px 8px", color: "#7F8DA3", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          Export CSV
        </button>
      </div>
      <div>
        {shown.length === 0 ? (
          <div style={{ padding: "10px 14px", fontSize: 11, color: "#65768D" }}>No charging sessions recorded.</div>
        ) : (
          shown.map((session, i) => (
            <div key={`${session.date}-${session.startTime}-${i}`} style={{ padding: "10px 14px", borderBottom: i < shown.length - 1 ? "1px solid #111A2B" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11.5, color: "#D7E2F2", fontWeight: 600 }}>{session.date} · {session.startTime}–{session.endTime}</div>
                <div style={{ fontSize: 10, color: "#667A93" }}>{session.kwh}kWh · {session.avgPence}p avg</div>
              </div>
              <div style={{ fontSize: 12, color: "#8CC4FF", fontWeight: 700 }}>£{session.cost.toFixed(2)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export interface HistoryTabProps {
  connectedDevices: DeviceConfig[];
  now: Date;
  latestCycleHeartbeat?: CycleHeartbeatEntry;
  recentCycleHeartbeats?: CycleHeartbeatEntry[];
  recentExecutionOutcomes?: ExecutionJournalEntry[];
  isDemo?: boolean;
}

export default function HistoryTab({
  connectedDevices,
  now,
  latestCycleHeartbeat,
  recentCycleHeartbeats = [],
  recentExecutionOutcomes = [],
  isDemo = false,
}: HistoryTabProps) {
  const [activeDevice, setActiveDevice] = useState<"all" | HistoryDeviceKey>("all");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  const baseHistory = (Array.isArray(SANDBOX?.history) ? SANDBOX.history : []) as HistoryDay[];
  const baseChargeSessions = (Array.isArray(SANDBOX?.chargeSessions) ? SANDBOX.chargeSessions : []) as ChargeSession[];

  const liveSnapshot = useMemo(
    () => ENABLE_HISTORY_SIMULATION ? buildLiveHistorySnapshot(now, baseHistory, baseChargeSessions) : { history: baseHistory, chargeSessions: baseChargeSessions },
    [now, baseHistory, baseChargeSessions]
  );

  const history = liveSnapshot.history;
  const currentWeekHistory = history.slice(-7);
  const chargeSessions = liveSnapshot.chargeSessions;

  useEffect(() => {
    setSelectedDayIndex(Math.max(0, currentWeekHistory.length - 1));
  }, [currentWeekHistory.length]);

  if (currentWeekHistory.length === 0) {
    return <div style={{ padding: "44px 24px 0", color: "#9CA3AF" }}>History data is temporarily unavailable.</div>;
  }

  const viewModel = buildHistoryViewModel({
    history,
    chargeSessions,
    connectedDevices,
    activeDevice,
    allTimeDelivered: SANDBOX.allTime,
    allTimeSince: SANDBOX.allTimeSince,
  });

  const selectedDayExplanation = viewModel.dayExplanations[selectedDayIndex] ?? [];
  const selectedDayExplanations = selectedDayExplanation.length > 0 ? selectedDayExplanation : viewModel.fallbackExplanation;
  const recentCycleItems = buildRecentCycleHistoryReadModel(recentCycleHeartbeats);
  const recentExecutionOutcomeItems = buildRecentExecutionOutcomesReadModel(recentExecutionOutcomes);
  const latestExecutionOutcomeDetail = buildLatestExecutionOutcomeDetailReadModel(recentExecutionOutcomes);
  const latestOutcomeExpectationComparison = buildLatestOutcomeExpectationComparisonReadModel(recentExecutionOutcomes);
  const recentOutcomeCounters = buildRecentOutcomeCountersReadModel(recentExecutionOutcomes);

  // Deterministic today top contributor — derived from live-scaled per-device fields on today's HistoryDay entry.
  // No inference: whichever of solar/battery/ev/grid has the highest value wins.
  const todayDay = currentWeekHistory[currentWeekHistory.length - 1];
  const todayDeviceCandidates: { key: "solar" | "battery" | "ev" | "grid"; value: number }[] = [
    { key: "solar", value: todayDay?.solar ?? 0 },
    { key: "battery", value: todayDay?.battery ?? 0 },
    { key: "ev", value: todayDay?.ev ?? 0 },
    { key: "grid", value: todayDay?.grid ?? 0 },
  ];
  const todayTopContributor = todayDeviceCandidates.reduce((best, c) => (c.value > best.value ? c : best), { key: "solar" as const, value: -1 });
  const todayTopDevice = todayTopContributor.value > 0 ? todayTopContributor.key : null;

  const topContributorName = viewModel.topDevice ? deviceDisplayName(viewModel.topDevice.id) : "Aveum";
  const weeklyNarrative =
    viewModel.weekEarnings > 0
      ? `${topContributorName} was the primary value source. Export and overnight charging added further gains.`
      : `${topContributorName} was the primary value source. Demand was shifted into lower-cost windows where possible.`;

  const exportWeeklyReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      weekTotal: viewModel.weekTotal,
      weekSavings: viewModel.weekSavings,
      weekEarnings: viewModel.weekEarnings,
      topDevice: viewModel.topDevice?.name ?? null,
      devices: viewModel.deviceBreakdown.map((device) => ({ id: device.id, name: device.name, total: device.total })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gridly-weekly-report.json";
    a.click();
  };

  const copyWeeklySummary = async () => {
    try {
      await navigator.clipboard.writeText(viewModel.weeklySummaryText);
      setShareStatus("Weekly recap copied");
    } catch {
      setShareStatus("Could not copy recap");
    }
  };

  const shareWeeklySummary = async () => {
    if (!navigator.share) {
      setShareStatus("Share not supported on this device");
      return;
    }

    try {
      await navigator.share({ title: "Aveum weekly delivery", text: viewModel.weeklySummaryText });
      setShareStatus("Shared successfully");
    } catch {
      setShareStatus("Share cancelled");
    }
  };

  return (
    <div style={{ background: "#060A12", minHeight: "100vh", paddingBottom: 40 }}>
      {/* ── 1. VALUE DELIVERY (primary content) ── */}
      <DeliveredHeroCard
        weekTotal={viewModel.weekTotal}
        weekSavings={viewModel.weekSavings}
        weekEarnings={viewModel.weekEarnings}
        freeDays={viewModel.freeDays}
        allTimeDelivered={viewModel.allTimeDelivered}
        allTimeSince={viewModel.allTimeSince}
        allTimeEarned={viewModel.allTimeEarned}
        todayValue={viewModel.values[viewModel.values.length - 1]}
        todayTopDevice={todayTopDevice}
      />

      <ValueContributionSection
        deviceBreakdown={viewModel.deviceBreakdown}
        weekTotal={viewModel.weekTotal}
      />

      {/* ── 2. SUPPORTING INSIGHTS ── */}
      <KeyMomentsSection moments={viewModel.smartMoments} />

      <WeekAtGlanceSection
        history={currentWeekHistory}
        activeDevice={activeDevice}
        setActiveDevice={setActiveDevice}
        connectedDevices={connectedDevices}
        values={viewModel.values}
        maxVal={viewModel.maxValue}
        activeColor={viewModel.activeColor}
        weeklyNarrative={weeklyNarrative}
        weekTotal={viewModel.weekTotal}
        selectedDayIndex={selectedDayIndex}
        setSelectedDayIndex={setSelectedDayIndex}
        selectedDayExplanations={selectedDayExplanations}
      />

      {/* ── 3. OPERATIONAL DETAILS ── */}
      <LatestCycleHeartbeatCard latestCycleHeartbeat={latestCycleHeartbeat} />

      {recentCycleItems.length > 0 && (
        <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 18, border: "1px solid #152238", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 10 }}>RECENT RUNS</div>
          {/* Shared canonical heartbeat truth, rendered as a minimal recent-cycles strip.
              This intentionally bridges toward a fuller runtime/journal-backed History surface. */}
          <div style={{ display: "grid", gap: 7 }}>
            {recentCycleItems.map((item) => (
              <div key={item.id} style={{ borderTop: "1px solid #111A2B", paddingTop: 7, display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 10.5, color: "#4E5E75", flexShrink: 0, minWidth: 36 }}>{item.recordedAtLabel}</div>
                <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.35 }}>
                  {[item.nextCycleExecutionCaution && `Caution: ${item.nextCycleExecutionCaution}`, item.householdObjectiveConfidence && `Confidence: ${item.householdObjectiveConfidence}`].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentExecutionOutcomeItems.length > 0 && (
        <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 18, border: "1px solid #152238", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 10 }}>RECENT ACTIONS</div>
          {latestExecutionOutcomeDetail && (
            <div style={{ marginBottom: 10, background: "#0A111D", border: "1px solid #111A2B", borderRadius: 12, padding: "10px 12px" }}>
              {/* Canonical latest execution outcome detail from journal truth only.
                  Intentionally minimal as a bridge toward a fuller accountability-backed History surface. */}
              {/* Presentation labels only. Canonical meaning from journal truth (commandLabel, outcomeStatus, executionConfidence, telemetryCoherence). */}
              <div style={{ fontSize: 9.5, color: "#4E5E75", fontWeight: 600, letterSpacing: 0.5, marginBottom: 5 }}>
                LAST ACTION
              </div>
              <div style={{ fontSize: 10, color: "#667A93", marginBottom: 6 }}>
                {latestExecutionOutcomeDetail.recordedAtLabel} · {latestExecutionOutcomeDetail.targetDeviceId}
              </div>
              <div style={{ display: "grid", gap: 3 }}>
                <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                  <span style={{ color: "#4E5E75" }}>Action</span>&nbsp;&nbsp;{latestExecutionOutcomeDetail.commandLabel}
                </div>
                <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                  <span style={{ color: "#4E5E75" }}>Result</span>&nbsp;&nbsp;{normalizeOutcomeStatusLabel(latestExecutionOutcomeDetail.outcomeStatus)}
                </div>
                {latestExecutionOutcomeDetail.executionConfidence && (
                  <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                    <span style={{ color: "#4E5E75" }}>Confidence</span>&nbsp;&nbsp;{latestExecutionOutcomeDetail.executionConfidence}
                  </div>
                )}
                {latestExecutionOutcomeDetail.executionEvidence && (
                  <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                    <span style={{ color: "#4E5E75" }}>Evidence</span>&nbsp;&nbsp;{latestExecutionOutcomeDetail.executionEvidence}
                  </div>
                )}
              </div>
            </div>
          )}

          {latestOutcomeExpectationComparison && (
            <div style={{ marginBottom: 10, background: "#0A111D", border: "1px solid #111A2B", borderRadius: 12, padding: "10px 12px" }}>
              {/* Expected-vs-actual view backed only by canonical runtime/journal truth.
                  Intentionally minimal and a bridge toward fuller expected-vs-realized accountability. */}
              {/* Presentation labels only. Canonical meaning from journal truth (expectedCommandLabel, actualOutcomeStatus, actualExecutionConfidence, actualExecutionEvidence). */}
              <div style={{ fontSize: 10, color: "#667A93", marginBottom: 8 }}>
                {latestOutcomeExpectationComparison.recordedAtLabel}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ paddingBottom: 6, borderBottom: "1px solid #152030" }}>
                  <div style={{ fontSize: 9.5, color: "#4E5E75", fontWeight: 600, letterSpacing: 0.5, marginBottom: 3 }}>PLANNED</div>
                  <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                    {latestOutcomeExpectationComparison.expectedCommandLabel} · {latestOutcomeExpectationComparison.expectedTargetDeviceId}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9.5, color: "#4E5E75", fontWeight: 600, letterSpacing: 0.5, marginBottom: 3 }}>DELIVERED</div>
                  <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                    {normalizeDeliveredOutcomeStatusLabel(latestOutcomeExpectationComparison.actualOutcomeStatus)}
                  </div>
                  {latestOutcomeExpectationComparison.actualExecutionConfidence && (
                    <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                      <span style={{ color: "#4E5E75" }}>Confidence</span>&nbsp;&nbsp;{latestOutcomeExpectationComparison.actualExecutionConfidence}
                    </div>
                  )}
                  {latestOutcomeExpectationComparison.actualExecutionEvidence && (
                    <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.4 }}>
                      <span style={{ color: "#4E5E75" }}>Evidence</span>&nbsp;&nbsp;{latestOutcomeExpectationComparison.actualExecutionEvidence}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "#70839B", lineHeight: 1.45, marginBottom: 8 }}>
            Some actions are not executed when conditions or constraints change.
          </div>
          {/* Counters derived only from canonical recent execution journal truth.
              This is intentionally minimal and acts as a bridge to a fuller accountability-backed History surface. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
            <div style={{ background: "#0A111D", border: "1px solid #111A2B", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#DCE6F5", whiteSpace: "nowrap" }}>Issued: {recentOutcomeCounters.issued}</div>
            </div>
            <div style={{ background: "#0A111D", border: "1px solid #111A2B", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div
                title="Skipped — conditions not met"
                aria-label="Skipped — conditions not met"
                style={{ fontSize: 11, fontWeight: 700, color: "#DCE6F5", whiteSpace: "nowrap" }}
              >
                Skipped: {recentOutcomeCounters.skipped}
              </div>
            </div>
            <div style={{ background: "#0A111D", border: "1px solid #111A2B", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#DCE6F5", whiteSpace: "nowrap" }}>Not run: {recentOutcomeCounters.failed}</div>
            </div>
            <div style={{ background: "#0A111D", border: "1px solid #111A2B", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#DCE6F5", whiteSpace: "nowrap" }}>Confirmed: {recentOutcomeCounters.evidenceConfirmed}</div>
            </div>
            <div style={{ background: "#0A111D", border: "1px solid #111A2B", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#DCE6F5", whiteSpace: "nowrap" }}>Uncertain: {recentOutcomeCounters.evidenceUncertain}</div>
            </div>
          </div>
          {/* Canonical execution/journal truth only, rendered minimally.
              This is an intentionally small bridge toward a fuller journal-backed History surface. */}
          <div style={{ display: "grid", gap: 8 }}>
            {recentExecutionOutcomeItems.map((item) => (
              <div key={item.id} style={{ borderTop: "1px solid #111A2B", paddingTop: 7, display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 10, color: "#4E5E75", flexShrink: 0, minWidth: 36 }}>{item.recordedAtLabel}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#4E5E75", marginBottom: 1 }}>{item.targetDeviceId}</div>
                  <div style={{ fontSize: 11, color: "#8EA0B8", lineHeight: 1.35 }}>
                    {[`Result: ${normalizeOutcomeStatusLabel(item.status)}`, item.executionConfidence && `Confidence: ${item.executionConfidence}`, item.telemetryCoherence && `Evidence: ${item.telemetryCoherence}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. DETAILED HISTORY ── */}
      <div style={{ margin: "24px 0 0" }}>
        <div style={{ borderTop: "1px solid #0A1020" }}>
          <CollapsibleSection label="Detailed history">
            <div style={{ margin: "0 20px 12px", fontSize: 12, color: "#8EA0B8", lineHeight: 1.55 }}>
              {viewModel.weeklyRecap}
            </div>

            {viewModel.weeklyComparison.explanations.length > 0 && (
              <div style={{ margin: "0 20px 12px", background: "#0A111D", border: "1px solid #182235", borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#5B6E87", fontWeight: 700, letterSpacing: 0.7, marginBottom: 6 }}>COMPARED TO LAST WEEK</div>
                <div style={{ display: "grid", gap: 5 }}>
                  {viewModel.weeklyComparison.explanations.map((line) => (
                    <div key={line} style={{ fontSize: 11.5, color: "#8EA0B8", lineHeight: 1.45 }}>• {line}</div>
                  ))}
                </div>
              </div>
            )}

            <SessionDetailsCard sessions={chargeSessions} />

            <div style={{ margin: "0 20px 4px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={copyWeeklySummary} style={{ background: "transparent", border: "1px solid #223044", borderRadius: 8, padding: "6px 10px", color: "#7F8DA3", fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Copy recap</button>
              <button onClick={exportWeeklyReport} style={{ background: "transparent", border: "1px solid #223044", borderRadius: 8, padding: "6px 10px", color: "#7F8DA3", fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Export report</button>
              <button onClick={shareWeeklySummary} style={{ background: "transparent", border: "1px solid #223044", borderRadius: 8, padding: "6px 10px", color: "#7F8DA3", fontSize: 10.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Share</button>
            </div>
            {shareStatus && <div style={{ margin: "8px 20px 0", fontSize: 10.5, color: "#7F8DA3" }}>{shareStatus}</div>}
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
