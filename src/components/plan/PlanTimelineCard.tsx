import { PlanTimelineViewModel } from "./planViewModels";
import { useState } from "react";
import { TIMELINE_EMPHASIS_TOKENS, timelineDotGlow } from "../timelineEmphasisTokens";
import { ENERGY_COLORS } from "../energyColors";
import DecisionExplanationSheet from "../DecisionExplanationSheet";

export type TimelineRowEmphasis = "active" | "soon" | "planned" | "default";

function sessionDotColor(coreAction?: string): string {
  if (coreAction === "charge_battery") return ENERGY_COLORS.battery;
  if (coreAction === "charge_ev") return ENERGY_COLORS.ev;
  if (coreAction === "export") return ENERGY_COLORS.solar;
  if (coreAction === "solar_use") return ENERGY_COLORS.solar;
  return "#6B7280";
}

function parseHHMM(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

function getRowTiming(time: string, nowMinutes: number) {
  const [startText, endText] = time.split("–");
  const start = parseHHMM(startText);
  const parsedEnd = endText ? parseHHMM(endText) : (start + 30) % (24 * 60);

  let end = parsedEnd;
  if (end <= start) end += 24 * 60;

  const now = nowMinutes;
  const nowShifted = now + (24 * 60);

  const isActive =
    (now >= start && now < end) ||
    (nowShifted >= start && nowShifted < end);

  const nextStart = start > now ? start : start + (24 * 60);
  const minutesToStart = nextStart - now;

  return { isActive, minutesToStart };
}

function isMeaningfulAction(action: string, coreAction?: string) {
  if (coreAction === "hold") return false;
  return action.trim().toLowerCase() !== "nothing to do";
}

export function deriveTimelineRowEmphasis(
  rows: PlanTimelineViewModel["rows"],
  nowDate: Date = new Date()
) {
  const nowMinutes = (nowDate.getHours() * 60) + nowDate.getMinutes();

  const timings = rows.map((row) => {
    const timing = getRowTiming(row.time, nowMinutes);
    return {
      row,
      ...timing,
      isSoon: !timing.isActive && timing.minutesToStart > 0 && timing.minutesToStart <= 5,
    };
  });

  const hasActiveOrSoon = timings.some((entry) => entry.isActive || entry.isSoon);

  const plannedCandidate = hasActiveOrSoon
    ? null
    : timings
        .filter((entry) => !entry.isActive && isMeaningfulAction(entry.row.action, entry.row.coreAction))
        .sort((a, b) => a.minutesToStart - b.minutesToStart)[0] ?? null;

  const emphasisByKey = new Map<string, TimelineRowEmphasis>();

  rows.forEach((row) => {
    const key = `${row.time}-${row.action}-${row.coreAction ?? "hold"}`;
    const entry = timings.find((item) => item.row === row);

    if (!entry) {
      emphasisByKey.set(key, "default");
      return;
    }

    if (entry.isActive) {
      emphasisByKey.set(key, "active");
      return;
    }

    if (entry.isSoon) {
      emphasisByKey.set(key, "soon");
      return;
    }

    if (plannedCandidate && plannedCandidate.row === row) {
      emphasisByKey.set(key, "planned");
      return;
    }

    emphasisByKey.set(key, "default");
  });

  return emphasisByKey;
}

export default function PlanTimelineCard({ viewModel, nowDate }: { viewModel: PlanTimelineViewModel; nowDate?: Date }) {
  const emphasisByKey = deriveTimelineRowEmphasis(viewModel.rows, nowDate ?? new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedRow = viewModel.rows.find((row) => `${row.time}-${row.action}-${row.coreAction ?? "hold"}` === selectedKey) ?? null;

  if (!viewModel.rows.length) return null;

  return (
    <div style={{ margin: "12px 16px 0", background: "#0B1120", borderRadius: 20, border: "1px solid #152238", padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 1.05, marginBottom: 12 }}>TOMORROW EXECUTION</div>
      {viewModel.rows.map((row, index) => {
        const rowKey = `${row.time}-${row.action}-${row.coreAction ?? "hold"}`;
        const emphasis = emphasisByKey.get(rowKey) ?? "default";
        const dot = sessionDotColor(row.coreAction);
        const token = TIMELINE_EMPHASIS_TOKENS[emphasis];
        const dotGlow = timelineDotGlow(emphasis, dot, index === 0);
        return (
          <button
            type="button"
            onClick={() => setSelectedKey(rowKey)}
            key={rowKey}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingTop: 8,
              paddingLeft: 8,
              paddingRight: 8,
              paddingBottom: 12,
              marginBottom: index < viewModel.rows.length - 1 ? 12 : 0,
              borderBottom: index < viewModel.rows.length - 1 ? "1px solid #111A2B" : "none",
              borderRadius: 10,
              background: token.background,
              boxShadow: token.boxShadow,
              borderLeft: token.borderLeft,
              width: "100%",
              borderTop: "none",
              borderRight: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 11, color: "#64738A", minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {row.time.includes("–") ? row.time.split("–")[0] : row.time}
            </div>
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                flexShrink: 0,
                background: dot,
                boxShadow: dotGlow,
              }}
            />
            <div
              style={{
                fontSize: 12.5,
                flex: 1,
                fontWeight: token.fontWeight,
                color: token.textColor,
              }}
            >
              {row.action}
            </div>
            <div style={{ fontSize: 10, color: "#68788F", textAlign: "right", width: 76, fontVariantNumeric: "tabular-nums" }}>{row.value}</div>
          </button>
        );
      })}

      <DecisionExplanationSheet
        open={Boolean(selectedRow)}
        title="Why Aveum chose this"
        subtitle={selectedRow ? `${selectedRow.action} · ${selectedRow.value}` : undefined}
        reasoning={selectedRow?.reasoning ?? []}
        onClose={() => setSelectedKey(null)}
      />
    </div>
  );
}
