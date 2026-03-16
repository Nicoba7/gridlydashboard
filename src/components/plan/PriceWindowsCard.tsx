import { PriceWindowsViewModel, getBarColor } from "./planViewModels";
import { useState } from "react";
import type { GridlyPlanSession } from "../../types/planCompat";

function toSlotIndex(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours * 2) + (minutes >= 30 ? 1 : 0);
}

export default function PriceWindowsCard({
  viewModel,
  rates,
  currentSlot,
  sessions,
}: {
  viewModel: PriceWindowsViewModel;
  rates: { time: string; pence: number }[];
  currentSlot: number;
  sessions: GridlyPlanSession[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxPence = Math.max(...rates.map((r) => r.pence));
  const minPence = Math.min(...rates.map((r) => r.pence));

  const plannedWindowSlots = new Set<number>();
  sessions.forEach((session) => {
    let start = toSlotIndex(session.start);
    let end = toSlotIndex(session.end);

    if (end <= start) end += 48;
    for (let slot = start; slot < end; slot++) {
      plannedWindowSlots.add(slot % 48);
    }
  });

  return (
    <div style={{ margin: "0 20px 16px", background: "#0A111D", border: "1px solid #182235", borderRadius: 18, padding: "15px 16px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#4E5E75", fontWeight: 700, letterSpacing: 0.95 }}>TODAY'S PRICES</div>
        <div style={{ fontSize: 11, color: "#7C8BA0" }}>
          <span style={{ color: getBarColor(rates[currentSlot]?.pence ?? 0), fontWeight: 700 }}>{rates[currentSlot]?.pence ?? "—"}p</span> now
        </div>
      </div>

      {hovered !== null && (
        <div style={{ fontSize: 11, color: "#C8D8EB", background: "#182235", borderRadius: 6, padding: "4px 8px", display: "inline-block", marginBottom: 8 }}>
          {rates[hovered].time} · <span style={{ color: getBarColor(rates[hovered].pence), fontWeight: 700 }}>{rates[hovered].pence}p</span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 44 }}>
        {rates.map((r, i) => (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer" }}
          >
            <div
              style={{
                width: "100%",
                height: Math.max(2, (r.pence / maxPence) * 44),
                boxShadow: plannedWindowSlots.has(i) ? "0 0 0 1px rgba(148, 163, 184, 0.24) inset" : "none",
                background:
                  r.pence === minPence
                    ? "#22C55E"
                    : i === currentSlot
                    ? "#A0B4CC"
                    : getBarColor(r.pence),
                opacity:
                  hovered === i
                    ? 0.95
                    : hovered !== null
                    ? plannedWindowSlots.has(i)
                      ? 0.42
                      : 0.12
                    : i === currentSlot
                    ? 0.72
                    : plannedWindowSlots.has(i)
                    ? 0.46
                    : 0.16,
                borderRadius: "2px 2px 0 0",
                transition: "opacity 0.12s",
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", marginTop: 4 }}>
        {rates.map((r, i) => (
          <div key={i} style={{ flex: 1, fontSize: 8, textAlign: "center", color: i === currentSlot ? "#7C8BA0" : "#2B3648" }}>
            {i % 4 === 0 ? r.time.split(":")[0] : ""}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10, color: "#56667B", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ minWidth: 124 }}>
          Low <span style={{ color: "#22C55E", fontWeight: 700 }}>{viewModel.cheapestRate}p</span> at {viewModel.cheapestWindow}
        </span>
        <span style={{ minWidth: 120, textAlign: "right" }}>
          Peak <span style={{ color: "#EF4444", fontWeight: 700 }}>{viewModel.peakRate}p</span> at {viewModel.peakWindow}
        </span>
      </div>
      {viewModel.solarWindow && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#56667B" }}>
          Solar peak around {viewModel.solarWindow} — {viewModel.solarStrength}
        </div>
      )}
    </div>
  );
}
