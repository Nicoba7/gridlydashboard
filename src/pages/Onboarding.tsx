import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Sun, Battery, Zap, Grid3X3, Eye, EyeOff, ExternalLink, Lock } from "lucide-react";

interface Device {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  description: string;
  saves: string;
}

const DEVICES: Device[] = [
  { id: "solar",   name: "Solar Inverter",       icon: Sun,      color: "#F59E0B", description: "Solar panels & inverter",      saves: "420" },
  { id: "battery", name: "Home Battery",          icon: Battery,  color: "#16A34A", description: "Battery storage system",       saves: "380" },
  { id: "ev",      name: "EV Charger",            icon: Zap,      color: "#38BDF8", description: "Electric vehicle charger",     saves: "310" },
  { id: "grid",    name: "Smart Meter / Octopus", icon: Grid3X3,  color: "#A78BFA", description: "Grid connection & pricing",    saves: "180" },
];

const EV_BRANDS = [
  {
    id: "zappi",
    name: "Zappi",
    description: "by myenergi",
    fields: [
      { key: "email",    label: "MYENERGI EMAIL",    placeholder: "you@example.com",  secret: false, hint: "Your myenergi account email" },
      { key: "password", label: "MYENERGI PASSWORD", placeholder: "••••••••",         secret: true  },
      { key: "serial",   label: "ZAPPI SERIAL",      placeholder: "XXXXXXXXXX",       secret: false, hint: "Look on the front of your Zappi unit — or myenergi app → Zappi → Settings → Serial" },
    ],
  },
  {
    id: "ohme",
    name: "Ohme",
    description: "Home / Home Pro / ePod",
    fields: [
      { key: "email",    label: "OHME EMAIL",    placeholder: "you@example.com", secret: false, hint: "The email you used to sign up to Ohme" },
      { key: "password", label: "OHME PASSWORD", placeholder: "••••••••",        secret: true  },
    ],
  },
  {
    id: "hypervolt",
    name: "Hypervolt",
    description: "Home 3 / Plus",
    fields: [
      { key: "apiKey",     label: "API KEY",     placeholder: "hv_xxxxxxxxxxxx",  secret: true,  hint: "Hypervolt app → Settings (bottom right) → API access → Generate key" },
      { key: "chargerId",  label: "CHARGER ID",  placeholder: "XXXXXXXXXXXX",     secret: false, hint: "Hypervolt app → your charger → Settings → Charger ID" },
    ],
  },
  {
    id: "wallbox",
    name: "Wallbox",
    description: "Pulsar / Commander / Copper",
    fields: [
      { key: "email",     label: "WALLBOX EMAIL",     placeholder: "you@example.com", secret: false, hint: "Your myWallbox account email" },
      { key: "password",  label: "WALLBOX PASSWORD",  placeholder: "••••••••",        secret: true  },
      { key: "chargerId", label: "CHARGER ID",        placeholder: "XXXXXXXXXX",      secret: false, hint: "myWallbox app → your charger → Settings → Serial number" },
    ],
  },
  {
    id: "easee",
    name: "Easee",
    description: "Home / Charge",
    fields: [
      { key: "email",     label: "EASEE EMAIL",     placeholder: "you@example.com", secret: false, hint: "Your Easee account email or phone number" },
      { key: "password",  label: "EASEE PASSWORD",  placeholder: "••••••••",        secret: true  },
      { key: "chargerId", label: "CHARGER ID",      placeholder: "EH123456",        secret: false, hint: "Easee app → your charger → Settings → Charger ID" },
    ],
  },
  {
    id: "podpoint",
    name: "Pod Point",
    description: "Solo / Solo 3",
    fields: [
      { key: "email",  label: "POD POINT EMAIL",    placeholder: "you@example.com", secret: false, hint: "Your Pod Point account email" },
      { key: "password", label: "POD POINT PASSWORD", placeholder: "••••••••",      secret: true  },
      { key: "unitId", label: "UNIT ID",            placeholder: "XXXXXXXX",        secret: false, hint: "Pod Point app → Home Charger → tap your charger → Unit ID" },
    ],
  },
];

// ── FIELD COMPONENT ───────────────────────────────────────────────────────
function Field({ label, placeholder, hint, link, value, onChange, secret }: {
  label: string; placeholder: string; hint?: string; link?: { text: string; url: string };
  value: string; onChange: (v: string) => void; secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={secret && !show ? "password" : "text"}
          placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", background: "#111827", border: "1px solid #374151", borderRadius: 10, padding: "11px 14px", paddingRight: secret ? 40 : 14, color: "#F9FAFB", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
        />
        {secret && (
          <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6B7280", padding: 0 }}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {(hint || link) && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {hint && <span style={{ fontSize: 10, color: "#4B5563" }}>{hint}</span>}
          {link && <a href={link.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#6B7280", display: "flex", alignItems: "center", gap: 3, textDecoration: "none" }}>{link.text} <ExternalLink size={9} /></a>}
        </div>
      )}
    </div>
  );
}

// ── OCTOPUS FORM ──────────────────────────────────────────────────────────
function OctopusForm({ creds, setCreds }: { creds: any; setCreds: any }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Grid3X3 size={16} color="#A78BFA" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>Octopus Energy</span>
      </div>
      <Field label="API KEY" placeholder="sk_live_xxxxxxxxxxxx" hint="Octopus app → your name (top right) → API access → copy the key starting with sk_live_" link={{ text: "Open Octopus", url: "https://octopus.energy/dashboard/new/accounts/personal-details/" }} value={creds.apiKey} onChange={v => setCreds((c: any) => ({ ...c, apiKey: v }))} secret />
      <Field label="ACCOUNT NUMBER" placeholder="A-XXXXXXXX" hint="Format: A- followed by 8 characters" value={creds.accountNumber} onChange={v => setCreds((c: any) => ({ ...c, accountNumber: v }))} />
    </div>
  );
}

// ── SOLAR / BATTERY FORM ──────────────────────────────────────────────────
const INVERTER_BRANDS = [
  {
    id: "givenergy",
    name: "GivEnergy",
    description: "All models",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-givenergy-api-key", secret: true, hint: "Go to givenergy.cloud → log in → click your name → Account Details → Generate API Key", link: { text: "Open GivEnergy", url: "https://givenergy.cloud" } },
      { key: "serial", label: "INVERTER SERIAL NUMBER", placeholder: "SA2XXXXXXXXXX", secret: false, hint: "Look for a sticker on your inverter — starts with SA2. Or GivEnergy app → your inverter → Settings" },
    ],
  },
  {
    id: "solax",
    name: "Solax",
    description: "X1 / X3 / Hybrid",
    fields: [
      { key: "tokenId", label: "TOKEN ID", placeholder: "20240XXXXXXXXXXX", secret: true, hint: "Go to solaxcloud.com → log in → Support → Third-party Ecology → copy your Token ID" },
      { key: "wifiSn", label: "WIFI DONGLE SERIAL", placeholder: "SUT****VB1", secret: false, hint: "Open Solax Cloud → tap your inverter → the serial number shown underneath it" },
    ],
  },
  {
    id: "solarEdge",
    name: "SolarEdge",
    description: "With battery",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-solaredge-api-key", secret: true, hint: "Go to monitoring.solaredge.com → Admin → Site Access → API Access → copy your key" },
      { key: "siteId", label: "SITE ID", placeholder: "XXXXXXX", secret: false, hint: "Same page — your Site ID is the number in the web address bar after /site/" },
    ],
  },
  {
    id: "solis",
    name: "Solis",
    description: "S5 / S6",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-solis-api-key", secret: true, hint: "Solis Cloud app → Account → API Management → copy your API Key" },
      { key: "apiSecret", label: "API SECRET", placeholder: "your-solis-api-secret", secret: true, hint: "Same screen as your API Key — tap to reveal and copy the secret" },
      { key: "stationId", label: "STATION ID", placeholder: "XXXXXXXXXX", secret: false, hint: "Solis Cloud app → tap your plant — the Station ID is shown under the plant name" },
    ],
  },
];

function SolarBatteryForm({ creds, setCreds }: { creds: any; setCreds: any }) {
  const [brand, setBrand] = useState<string>(creds.brand || "");
  const selectedBrand = INVERTER_BRANDS.find(b => b.id === brand);

  const handleBrandSelect = (id: string) => {
    setBrand(id);
    setCreds({ brand: id });
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Sun size={16} color="#F59E0B" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>Solar & Battery</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 8, letterSpacing: 0.5 }}>SELECT YOUR INVERTER BRAND</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {INVERTER_BRANDS.map(b => (
          <button
            key={b.id}
            onClick={() => handleBrandSelect(b.id)}
            style={{
              background: brand === b.id ? "#F59E0B20" : "#111827",
              border: `2px solid ${brand === b.id ? "#F59E0B" : "#374151"}`,
              borderRadius: 10, padding: "10px 12px", cursor: "pointer",
              textAlign: "left", fontFamily: "inherit", transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: brand === b.id ? "#F59E0B" : "#F9FAFB", marginBottom: 2 }}>{b.name}</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>{b.description}</div>
          </button>
        ))}
      </div>
      {selectedBrand && (
        <div>
          {selectedBrand.fields.map(field => (
            <Field
              key={field.key}
              label={field.label}
              placeholder={field.placeholder}
              hint={(field as any).hint}
              link={(field as any).link}
              secret={field.secret}
              value={creds[field.key] || ""}
              onChange={v => setCreds((c: any) => ({ ...c, [field.key]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── EV FORM — brand selector + dynamic fields ─────────────────────────────
function EVForm({ creds, setCreds }: { creds: any; setCreds: any }) {
  const [brand, setBrand] = useState<string>(creds.brand || "");

  const selectedBrand = EV_BRANDS.find(b => b.id === brand);

  const handleBrandSelect = (id: string) => {
    setBrand(id);
    setCreds((c: any) => ({ brand: id })); // reset fields on brand change
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Zap size={16} color="#38BDF8" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>EV Charger</span>
      </div>

      {/* Brand selector */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 8, letterSpacing: 0.5 }}>SELECT YOUR CHARGER BRAND</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {EV_BRANDS.map(b => (
          <button
            key={b.id}
            onClick={() => handleBrandSelect(b.id)}
            style={{
              background: brand === b.id ? "#38BDF820" : "#111827",
              border: `2px solid ${brand === b.id ? "#38BDF8" : "#374151"}`,
              borderRadius: 10, padding: "10px 12px", cursor: "pointer",
              textAlign: "left", fontFamily: "inherit", transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: brand === b.id ? "#38BDF8" : "#F9FAFB", marginBottom: 2 }}>{b.name}</div>
            <div style={{ fontSize: 10, color: "#6B7280" }}>{b.description}</div>
          </button>
        ))}
      </div>

      {/* Dynamic fields for selected brand */}
      {selectedBrand && (
        <div>
          {selectedBrand.fields.map(field => (
            <Field
              key={field.key}
              label={field.label}
              placeholder={field.placeholder}
              hint={field.hint}
              secret={field.secret}
              value={creds[field.key] || ""}
              onChange={v => setCreds((c: any) => ({ ...c, [field.key]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────
interface OnboardingProps {
  onComplete?: (devices: string[], creds: any) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [octopusCreds, setOctopusCreds] = useState({ apiKey: "", accountNumber: "" });
  const [solarCreds, setSolarCreds] = useState({ apiKey: "", serial: "" });
  const [evCreds, setEvCreds] = useState<any>({ brand: "" });

  const toggleDevice = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const totalSavings = DEVICES.filter(d => selected.includes(d.id)).reduce((sum, d) => sum + parseInt(d.saves), 0);
  const needsOctopus = selected.includes("grid");
  const needsSolar = selected.includes("solar") || selected.includes("battery");
  const needsEV = selected.includes("ev");

  const handleComplete = () => {
    if (onComplete) onComplete(selected, { octopusCreds, solarCreds, evCreds });
    navigate(`/dashboard?devices=${selected.join(",")}`);
  };

  return (
    <div style={{ background: "linear-gradient(135deg, #111827 0%, #0F1419 100%)", minHeight: "100vh", display: "flex", flexDirection: "column", padding: "20px", color: "#F9FAFB", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", maxWidth: 420, margin: "0 auto" }}>

      <div style={{ marginBottom: 28, marginTop: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: -0.5 }}>
          {step === 1 && "What do you have?"}
          {step === 2 && "Connect your devices"}
          {step === 3 && "You're all set"}
        </h1>
        <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>
          {step === 1 && "Select everything you have — we'll show you what you could earn"}
          {step === 2 && "Enter your account details — takes 2 minutes"}
          {step === 3 && `£${totalSavings}/yr unlocked and optimising`}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 28, display: "flex", gap: 6 }}>
        {[1, 2, 3].map(s => (
          <div key={s} style={{ height: 3, flex: 1, background: s <= step ? "#22C55E" : "#1F2937", borderRadius: 2, transition: "background 0.3s ease" }} />
        ))}
      </div>

      {/* Step 1 — device selection */}
      {step === 1 && (
        <div style={{ flex: 1, marginBottom: 20 }}>
          <div style={{ display: "grid", gap: 10 }}>
            {DEVICES.map(device => {
              const Icon = device.icon;
              const isSelected = selected.includes(device.id);
              return (
                <button key={device.id} onClick={() => toggleDevice(device.id)} style={{ background: isSelected ? "#16A34A20" : "#1F2937", border: isSelected ? "2px solid #22C55E" : "2px solid #374151", borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "center", cursor: "pointer", transition: "all 0.15s ease", textAlign: "left" }}>
                  <div style={{ background: `${device.color}20`, borderRadius: 8, padding: 9 }}>
                    <Icon size={20} color={device.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#F9FAFB", marginBottom: 1 }}>{device.name}</div>
                    <div style={{ fontSize: 11, color: "#9CA3AF" }}>{device.description}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: device.color, marginTop: 3 }}>+£{device.saves}/yr value</div>
                  </div>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: isSelected ? "#22C55E" : "#374151", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {isSelected && <div style={{ width: 8, height: 8, background: "#111827", borderRadius: 2 }} />}
                  </div>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 10, padding: "10px 14px", marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#6B7280" }}>Annual value selected</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>£{totalSavings}/yr</span>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — credentials */}
      {step === 2 && (
        <div style={{ flex: 1, marginBottom: 20 }}>
          <div style={{ background: "#0F1929", border: "1px solid #1E3A5F", borderRadius: 10, padding: "10px 14px", marginBottom: 20, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Lock size={13} color="#60A5FA" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#93C5FD", lineHeight: 1.5 }}>Your credentials are encrypted and never shared. We only read data — we never make changes without your permission.</span>
          </div>
          {needsOctopus && <OctopusForm creds={octopusCreds} setCreds={setOctopusCreds} />}
          {needsSolar && <SolarBatteryForm creds={solarCreds} setCreds={setSolarCreds} />}
          {needsEV && <EVForm creds={evCreds} setCreds={setEvCreds} />}
          <button onClick={() => setStep(3)} style={{ background: "none", border: "none", color: "#4B5563", fontSize: 12, cursor: "pointer", padding: "6px 0", fontFamily: "inherit", display: "block" }}>
            Skip — use demo data instead
          </button>
        </div>
      )}

      {/* Step 3 — complete */}
      {step === 3 && (
        <div style={{ flex: 1, marginBottom: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 72, height: 72, background: "#16A34A20", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, background: "#22C55E", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>✓</div>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>Connected & optimising</h2>
          <p style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", marginBottom: 24, maxWidth: 260, lineHeight: 1.6 }}>
            Gridly is reading prices every 30 minutes and automatically optimising your system.
          </p>
          <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 12, padding: 16, width: "100%", textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>Annual value unlocked</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#22C55E", letterSpacing: -1 }}>£{totalSavings}</div>
            <div style={{ height: 6, background: "#1F2937", borderRadius: 99, marginTop: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min((totalSavings / 1400) * 100, 100)}%`, background: "#22C55E", borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 10, color: "#4B5563", marginTop: 4 }}>of £1,400 maximum</div>
          </div>
          {DEVICES.filter(d => !selected.includes(d.id)).map(d => (
            <div key={d.id} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1F2937" }}>
              <span style={{ fontSize: 12, color: "#4B5563" }}>+ {d.name}</span>
              <span style={{ fontSize: 12, color: "#4B5563" }}>+£{d.saves}/yr locked</span>
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", gap: 10, paddingBottom: 20 }}>
        {step > 1 && (
          <button onClick={() => setStep(step - 1)} style={{ flex: 1, background: "#1F2937", border: "1px solid #374151", borderRadius: 10, padding: "13px 16px", color: "#F9FAFB", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Back</button>
        )}
        <button
          onClick={step === 3 ? handleComplete : () => setStep(step + 1)}
          disabled={step === 1 && selected.length === 0}
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "13px 16px", background: step === 1 && selected.length === 0 ? "#374151" : "#22C55E", color: step === 1 && selected.length === 0 ? "#6B7280" : "#111827", fontSize: 14, fontWeight: 700, cursor: step === 1 && selected.length === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit" }}
        >
          {step === 3 ? "Go to Dashboard" : "Next"}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
