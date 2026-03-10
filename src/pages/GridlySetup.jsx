import { useState } from "react";
import { Battery, Zap, Sun, ChevronRight, Check, ExternalLink, Eye, EyeOff, Wifi } from "lucide-react";

const STEPS = ["welcome", "octopus", "givenergy", "zappi", "complete"];

function ProgressDots({ current }) {
  const steps = ["octopus", "givenergy", "zappi"];
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 32 }}>
      {steps.map((s, i) => (
        <div key={s} style={{
          width: current === s ? 20 : 8,
          height: 8,
          borderRadius: 99,
          background: steps.indexOf(current) >= i ? "#16A34A" : "#1F2937",
          transition: "all 0.3s ease"
        }} />
      ))}
    </div>
  );
}

function InputField({ label, placeholder, value, onChange, type = "text", hint, show, onToggle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 600, display: "block", marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={type === "password" ? (show ? "text" : "password") : type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: "100%",
            background: "#111827",
            border: "1px solid #1F2937",
            borderRadius: 12,
            padding: "12px 16px",
            color: "#F9FAFB",
            fontSize: 13,
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
            paddingRight: type === "password" ? 44 : 16,
          }}
        />
        {type === "password" && (
          <button onClick={onToggle} style={{
            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer", color: "#6B7280", padding: 0
          }}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: "#4B5563", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function StepCard({ icon: Icon, color, bg, title, description, children, onNext, onSkip, nextLabel = "Connect", loading }) {
  return (
    <div style={{ padding: "0 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <div style={{ background: bg, borderRadius: 16, padding: 12, flexShrink: 0 }}>
          <Icon size={24} color={color} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5 }}>{title}</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{description}</div>
        </div>
      </div>
      {children}
      <button onClick={onNext} disabled={loading} style={{
        width: "100%", background: color, border: "none", borderRadius: 14,
        padding: "14px 20px", color: "#fff", fontSize: 15, fontWeight: 700,
        cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        marginTop: 8, fontFamily: "inherit"
      }}>
        {loading ? "Connecting…" : nextLabel}
        {!loading && <ChevronRight size={18} />}
      </button>
      {onSkip && (
        <button onClick={onSkip} style={{
          width: "100%", background: "none", border: "none", color: "#4B5563",
          fontSize: 13, cursor: "pointer", padding: "10px 0", fontFamily: "inherit"
        }}>
          Skip for now — use demo data
        </button>
      )}
    </div>
  );
}

export default function GridlySetup({ onComplete }) {
  const [step, setStep] = useState("welcome");
  const [showKey, setShowKey] = useState({});
  const [connected, setConnected] = useState({});
  const [loading, setLoading] = useState(false);

  const [octopus, setOctopus] = useState({ apiKey: "", accountNumber: "" });
  const [givenergy, setGivenergy] = useState({ apiKey: "", serial: "" });
  const [zappi, setZappi] = useState({ email: "", password: "", serial: "" });

  const simulateConnect = (key, next) => {
    setLoading(true);
    setTimeout(() => {
      setConnected(c => ({ ...c, [key]: true }));
      setLoading(false);
      setStep(next);
    }, 1500);
  };

  const skip = (next) => setStep(next);

  if (step === "welcome") return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      display: "flex", flexDirection: "column", justifyContent: "center",
      maxWidth: 420, margin: "0 auto", padding: "40px 20px"
    }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{
          width: 72, height: 72, background: "#0D1F14", border: "2px solid #16A34A",
          borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px"
        }}>
          <Wifi size={32} color="#16A34A" />
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5, marginBottom: 8 }}>
          Welcome to Gridly
        </div>
        <div style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
          Connect your energy hardware and we'll automatically optimise everything against live grid pricing.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {[
          { icon: Sun, color: "#F59E0B", bg: "#F59E0B20", label: "Octopus Energy", sub: "Live Agile pricing" },
          { icon: Battery, color: "#16A34A", bg: "#16A34A20", label: "GivEnergy", sub: "Solar inverter & battery" },
          { icon: Zap, color: "#38BDF8", bg: "#38BDF820", label: "Zappi / myenergi", sub: "EV charger" },
        ].map(({ icon: Icon, color, bg, label, sub }) => (
          <div key={label} style={{
            background: "#111827", border: "1px solid #1F2937", borderRadius: 14,
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 12
          }}>
            <div style={{ background: bg, borderRadius: 10, padding: 8 }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>{label}</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{sub}</div>
            </div>
            <ChevronRight size={16} color="#374151" style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>

      <button onClick={() => setStep("octopus")} style={{
        width: "100%", background: "#16A34A", border: "none", borderRadius: 14,
        padding: "16px 20px", color: "#fff", fontSize: 16, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", marginBottom: 12
      }}>
        Get started
      </button>
      <button onClick={() => onComplete({ demo: true })} style={{
        width: "100%", background: "none", border: "none", color: "#4B5563",
        fontSize: 13, cursor: "pointer", padding: "8px 0", fontFamily: "inherit"
      }}>
        View demo first
      </button>
    </div>
  );

  if (step === "octopus") return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      maxWidth: 420, margin: "0 auto", paddingTop: 60
    }}>
      <ProgressDots current="octopus" />
      <StepCard
        icon={Sun} color="#F59E0B" bg="#F59E0B20"
        title="Octopus Energy"
        description="Connect for live Agile pricing"
        onNext={() => simulateConnect("octopus", "givenergy")}
        onSkip={() => skip("givenergy")}
        loading={loading}
        nextLabel="Connect Octopus"
      >
        <div style={{ background: "#0D1208", border: "1px solid #F59E0B30", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600, marginBottom: 4 }}>HOW TO FIND YOUR API KEY</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
            Log into octopus.energy → Account → scroll to API access → copy your key
          </div>
          <a href="https://octopus.energy/dashboard/new/accounts/personal-details/" target="_blank" rel="noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, color: "#F59E0B", fontSize: 11, marginTop: 6, textDecoration: "none" }}>
            Open Octopus account <ExternalLink size={10} />
          </a>
        </div>
        <InputField label="API Key" placeholder="sk_live_xxxxxxxxxxxx"
          value={octopus.apiKey} onChange={v => setOctopus(o => ({ ...o, apiKey: v }))}
          type="password" show={showKey.octopus} onToggle={() => setShowKey(s => ({ ...s, octopus: !s.octopus }))}
          hint="Found in your Octopus account under API access" />
        <InputField label="Account Number" placeholder="A-XXXXXXXX"
          value={octopus.accountNumber} onChange={v => setOctopus(o => ({ ...o, accountNumber: v }))}
          hint="Format: A- followed by 8 characters" />
      </StepCard>
    </div>
  );

  if (step === "givenergy") return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      maxWidth: 420, margin: "0 auto", paddingTop: 60
    }}>
      <ProgressDots current="givenergy" />
      <StepCard
        icon={Battery} color="#16A34A" bg="#16A34A20"
        title="GivEnergy"
        description="Connect your inverter & battery"
        onNext={() => simulateConnect("givenergy", "zappi")}
        onSkip={() => skip("zappi")}
        loading={loading}
        nextLabel="Connect GivEnergy"
      >
        <div style={{ background: "#0D1F14", border: "1px solid #16A34A30", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#16A34A", fontWeight: 600, marginBottom: 4 }}>HOW TO FIND YOUR API KEY</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
            Log into givenergy.cloud → Account Details → Generate API Key → check your email
          </div>
          <a href="https://givenergy.cloud" target="_blank" rel="noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 4, color: "#16A34A", fontSize: 11, marginTop: 6, textDecoration: "none" }}>
            Open GivEnergy portal <ExternalLink size={10} />
          </a>
        </div>
        <InputField label="API Key" placeholder="your-givenergy-api-key"
          value={givenergy.apiKey} onChange={v => setGivenergy(g => ({ ...g, apiKey: v }))}
          type="password" show={showKey.givenergy} onToggle={() => setShowKey(s => ({ ...s, givenergy: !s.givenergy }))}
          hint="Generated from givenergy.cloud account settings" />
        <InputField label="Inverter Serial Number" placeholder="SA2XXXXXXXXXX"
          value={givenergy.serial} onChange={v => setGivenergy(g => ({ ...g, serial: v }))}
          hint="Found on the sticker on your inverter or in the app" />
      </StepCard>
    </div>
  );

  if (step === "zappi") return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      maxWidth: 420, margin: "0 auto", paddingTop: 60
    }}>
      <ProgressDots current="zappi" />
      <StepCard
        icon={Zap} color="#38BDF8" bg="#38BDF820"
        title="Zappi Charger"
        description="Connect your EV charger"
        onNext={() => simulateConnect("zappi", "complete")}
        onSkip={() => skip("complete")}
        loading={loading}
        nextLabel="Connect Zappi"
      >
        <div style={{ background: "#0A1929", border: "1px solid #38BDF830", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 600, marginBottom: 4 }}>HOW TO CONNECT</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.6 }}>
            Use your myenergi app login credentials. Your serial number is on the front of the Zappi unit.
          </div>
        </div>
        <InputField label="myenergi Email" placeholder="you@example.com"
          value={zappi.email} onChange={v => setZappi(z => ({ ...z, email: v }))} />
        <InputField label="myenergi Password" placeholder="••••••••"
          value={zappi.password} onChange={v => setZappi(z => ({ ...z, password: v }))}
          type="password" show={showKey.zappi} onToggle={() => setShowKey(s => ({ ...s, zappi: !s.zappi }))} />
        <InputField label="Zappi Serial Number" placeholder="XXXXXXXXXX"
          value={zappi.serial} onChange={v => setZappi(z => ({ ...z, serial: v }))}
          hint="Printed on the front label of your Zappi unit" />
      </StepCard>
    </div>
  );

  if (step === "complete") return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      display: "flex", flexDirection: "column", justifyContent: "center",
      maxWidth: 420, margin: "0 auto", padding: "40px 20px", textAlign: "center"
    }}>
      <div style={{
        width: 72, height: 72, background: "#0D1F14", border: "2px solid #16A34A",
        borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 24px"
      }}>
        <Check size={32} color="#16A34A" />
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#F9FAFB", letterSpacing: -0.5, marginBottom: 8 }}>
        You're all set
      </div>
      <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 40, lineHeight: 1.6 }}>
        Gridly is now monitoring your energy system and optimising automatically against live Agile prices.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 36 }}>
        {[
          { icon: Sun, color: "#F59E0B", label: "Octopus Energy", status: connected.octopus ? "Connected" : "Demo data" },
          { icon: Battery, color: "#16A34A", label: "GivEnergy", status: connected.givenergy ? "Connected" : "Demo data" },
          { icon: Zap, color: "#38BDF8", label: "Zappi", status: connected.zappi ? "Connected" : "Demo data" },
        ].map(({ icon: Icon, color, label, status }) => (
          <div key={label} style={{
            background: "#111827", border: "1px solid #1F2937", borderRadius: 14,
            padding: "12px 16px", display: "flex", alignItems: "center", gap: 12
          }}>
            <Icon size={18} color={color} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB", flex: 1 }}>{label}</span>
            <span style={{ fontSize: 11, color: status === "Demo data" ? "#4B5563" : "#16A34A", fontWeight: 600 }}>
              {status === "Demo data" ? "Demo data" : "✓ " + status}
            </span>
          </div>
        ))}
      </div>

      <button onClick={() => onComplete({ octopus, givenergy, zappi, connected })} style={{
        width: "100%", background: "#16A34A", border: "none", borderRadius: 14,
        padding: "16px 20px", color: "#fff", fontSize: 16, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit"
      }}>
        Go to my dashboard
      </button>
    </div>
  );

  return null;
}
