import { useState } from "react";
import { Sun, Battery, Zap, ChevronRight, Check, Wifi } from "lucide-react";

const DEVICES = [
  { id: "solar", name: "Solar Inverter", icon: Sun, color: "#F59E0B", bg: "#F59E0B20", monthlyValue: 35, description: "We'll read your solar generation and use it smarter" },
  { id: "battery", name: "Home Battery", icon: Battery, color: "#16A34A", bg: "#16A34A20", monthlyValue: 32, description: "We'll charge when electricity is cheap, export when it's expensive" },
  { id: "ev", name: "EV Charger", icon: Zap, color: "#38BDF8", bg: "#38BDF820", monthlyValue: 26, description: "We'll charge your car at the cheapest overnight rates" },
];

export default function GridlySetup({ onComplete }) {
  const [step, setStep] = useState("welcome");
  const [selected, setSelected] = useState(["solar", "battery", "ev"]);

  const toggleDevice = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const totalMonthly = DEVICES.filter((d) => selected.includes(d.id)).reduce((s, d) => s + d.monthlyValue, 0);
  const totalAnnual = totalMonthly * 12;

  const shell = (children) => (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      display: "flex", flexDirection: "column", justifyContent: "center",
      maxWidth: 420, margin: "0 auto", padding: "40px 20px"
    }}>
      {children}
    </div>
  );

  // STEP 1: Welcome
  if (step === "welcome") return shell(
    <>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          width: 72, height: 72, background: "#0D1F14", border: "2px solid #16A34A",
          borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px"
        }}>
          <Wifi size={32} color="#16A34A" />
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5, marginBottom: 8 }}>
          Save money on your energy bills
        </div>
        <div style={{ fontSize: 14, color: "#9CA3AF", lineHeight: 1.6 }}>
          Gridly connects your home energy devices and automatically finds cheaper electricity for you.
        </div>
      </div>

      <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 16, padding: 20, textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Households like yours save up to</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "#22C55E", letterSpacing: -1 }}>£1,100</div>
        <div style={{ fontSize: 13, color: "#9CA3AF" }}>per year</div>
      </div>

      <button onClick={() => setStep("devices")} style={{
        width: "100%", background: "#16A34A", border: "none", borderRadius: 14,
        padding: "16px 20px", color: "#fff", fontSize: 16, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        See what I could save <ChevronRight size={18} />
      </button>
      <button onClick={() => onComplete({ demo: true })} style={{
        width: "100%", background: "none", border: "none", color: "#4B5563",
        fontSize: 13, cursor: "pointer", padding: "12px 0", fontFamily: "inherit"
      }}>
        Skip — show me a demo
      </button>
    </>
  );

  // STEP 2: Select your devices
  if (step === "devices") return shell(
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ height: 4, flex: 1, borderRadius: 99, background: s <= 1 ? "#16A34A" : "#1F2937", transition: "all 0.3s" }} />
        ))}
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5, marginBottom: 6 }}>
          What devices do you have?
        </div>
        <div style={{ fontSize: 13, color: "#9CA3AF" }}>
          Tap the ones installed at your home. We'll calculate your savings.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {DEVICES.map(({ id, name, icon: Icon, color, bg, monthlyValue, description }) => {
          const isSelected = selected.includes(id);
          return (
            <button key={id} onClick={() => toggleDevice(id)} style={{
              background: isSelected ? `${color}15` : "#111827",
              border: isSelected ? `2px solid ${color}` : "2px solid #1F2937",
              borderRadius: 14, padding: "16px", display: "flex", alignItems: "center", gap: 14,
              cursor: "pointer", transition: "all 0.2s", textAlign: "left"
            }}>
              <div style={{ background: bg, borderRadius: 12, padding: 10, flexShrink: 0 }}>
                <Icon size={22} color={color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 }}>{name}</div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>{description}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color }}>+£{monthlyValue}</div>
                <div style={{ fontSize: 10, color: "#6B7280" }}>/month</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#9CA3AF" }}>Your estimated savings</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "#22C55E" }}>£{totalAnnual}/yr</span>
        </div>
      )}

      <button onClick={() => setStep("confirm")} disabled={selected.length === 0} style={{
        width: "100%", background: selected.length === 0 ? "#374151" : "#16A34A", border: "none", borderRadius: 14,
        padding: "16px 20px", color: selected.length === 0 ? "#6B7280" : "#fff", fontSize: 16, fontWeight: 700,
        cursor: selected.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        Continue <ChevronRight size={18} />
      </button>
    </>
  );

  // STEP 3: Confirmation
  if (step === "confirm") return shell(
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
        {[1, 2, 3].map((s) => (
          <div key={s} style={{ height: 4, flex: 1, borderRadius: 99, background: s <= 2 ? "#16A34A" : "#1F2937", transition: "all 0.3s" }} />
        ))}
      </div>

      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          width: 72, height: 72, background: "#0D1F14", border: "2px solid #16A34A",
          borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px"
        }}>
          <Check size={32} color="#16A34A" />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5, marginBottom: 8 }}>
          You're all set!
        </div>
        <div style={{ fontSize: 14, color: "#9CA3AF", lineHeight: 1.6 }}>
          Gridly will start saving you money automatically. No complicated setup required.
        </div>
      </div>

      <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 16, padding: 20, textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>Your estimated annual savings</div>
        <div style={{ fontSize: 42, fontWeight: 800, color: "#22C55E", letterSpacing: -1 }}>£{totalAnnual}</div>
        <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 4 }}>That's £{totalMonthly} every month back in your pocket</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {DEVICES.filter(d => selected.includes(d.id)).map(({ id, name, icon: Icon, color, monthlyValue }) => (
          <div key={id} style={{
            background: "#111827", border: "1px solid #1F2937", borderRadius: 12,
            padding: "12px 16px", display: "flex", alignItems: "center", gap: 12
          }}>
            <Icon size={18} color={color} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB", flex: 1 }}>{name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>+£{monthlyValue}/mo</span>
          </div>
        ))}
      </div>

      <button onClick={() => onComplete({ selected, demo: false })} style={{
        width: "100%", background: "#16A34A", border: "none", borderRadius: 14,
        padding: "16px 20px", color: "#fff", fontSize: 16, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        Go to my dashboard <ChevronRight size={18} />
      </button>
      <button onClick={() => setStep("devices")} style={{
        width: "100%", background: "none", border: "none", color: "#4B5563",
        fontSize: 13, cursor: "pointer", padding: "12px 0", fontFamily: "inherit"
      }}>
        ← Change my devices
      </button>
    </>
  );

  return null;
}
