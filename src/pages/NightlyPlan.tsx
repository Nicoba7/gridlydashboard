import { Battery, TrendingUp, Sun, Pause } from "lucide-react";
import {
  buildOptimizerInputFromLegacyPlanContext,
  optimizeForLegacyPlanUi,
  type LegacyConnectedDeviceId,
} from "../optimizer";

export default function NightlyPlan() {

  const rates = [
    { time: "00:00", pence: 7.2 }, { time: "00:30", pence: 6.8 },
    { time: "01:00", pence: 6.1 }, { time: "01:30", pence: 5.9 },
    { time: "02:00", pence: 5.4 }, { time: "02:30", pence: 5.1 },
    { time: "03:00", pence: 4.8 }, { time: "03:30", pence: 4.6 },
    { time: "04:00", pence: 4.9 }, { time: "04:30", pence: 5.3 },
    { time: "05:00", pence: 6.2 }, { time: "05:30", pence: 8.1 },
    { time: "06:00", pence: 12.4 }, { time: "06:30", pence: 18.7 },
    { time: "07:00", pence: 24.3 }, { time: "07:30", pence: 28.9 },
    { time: "08:00", pence: 31.2 }, { time: "08:30", pence: 29.4 },
    { time: "09:00", pence: 24.1 }, { time: "09:30", pence: 19.8 },
    { time: "10:00", pence: 16.2 }, { time: "10:30", pence: 13.4 },
    { time: "11:00", pence: 11.8 }, { time: "11:30", pence: 10.2 },
    { time: "12:00", pence: 9.6 }, { time: "12:30", pence: 8.9 },
    { time: "13:00", pence: 9.1 }, { time: "13:30", pence: 10.4 },
    { time: "14:00", pence: 11.2 }, { time: "14:30", pence: 12.8 },
    { time: "15:00", pence: 14.6 }, { time: "15:30", pence: 17.3 },
    { time: "16:00", pence: 22.1 }, { time: "16:30", pence: 27.8 },
    { time: "17:00", pence: 34.2 }, { time: "17:30", pence: 38.6 },
    { time: "18:00", pence: 35.4 }, { time: "18:30", pence: 29.7 },
    { time: "19:00", pence: 22.3 }, { time: "19:30", pence: 17.6 },
    { time: "20:00", pence: 14.2 }, { time: "20:30", pence: 11.8 },
    { time: "21:00", pence: 10.1 }, { time: "21:30", pence: 9.4 },
    { time: "22:00", pence: 8.7 }, { time: "22:30", pence: 8.1 },
    { time: "23:00", pence: 7.6 }, { time: "23:30", pence: 7.1 },
  ];

  const connectedDeviceIds: LegacyConnectedDeviceId[] = ["solar", "battery", "ev", "grid"];
  const optimizerInput = buildOptimizerInputFromLegacyPlanContext({
    now: new Date(),
    rates,
    connectedDeviceIds,
    planningStyle: "CHEAPEST",
    solarForecastKwh: 18.4,
    batteryStartPct: 62,
    batteryCapacityKwh: 10,
    batteryReservePct: 22,
    maxBatteryCyclesPerDay: 2,
    evTargetKwh: 16,
    evReadyBy: "07:00",
    exportPriceRatio: 0.72,
  });

  const { plan, summary } = optimizeForLegacyPlanUi(optimizerInput);

  const net = (summary.projectedEarnings + summary.projectedSavings).toFixed(2);

  const iconMap = {
    CHARGE: Battery,
    EXPORT: TrendingUp,
    HOLD: Pause,
    SOLAR: Sun,
  };

  return (
    <div style={{ background: "#0D1117", border: "1px solid #1F2937", borderRadius: 12, padding: "16px", marginBottom: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280" }}>
            GRIDLY'S PLAN FOR TONIGHT
          </div>
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>
            Already sorted — nothing you need to do
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Projected savings &amp; earnings</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#22C55E" }}>
            +£{net}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div>
        {plan.map((slot, i) => {
          const Icon = iconMap[slot.action];

          return (
            <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <Icon size={16} color={slot.color} />

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{slot.title}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
                  {slot.reason}
                </div>
              </div>

              <div style={{ fontWeight: 700, color: slot.color }}>
                {slot.price}p
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
