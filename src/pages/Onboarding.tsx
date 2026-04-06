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
    id: "ohme",
    name: "Ohme",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "ohmeEmail",    label: "OHME ACCOUNT EMAIL", placeholder: "you@example.com", secret: false, hint: "Your Ohme account email" },
      { key: "ohmePassword", label: "OHME PASSWORD",       placeholder: "••••••••",        secret: true  },
    ],
  },
  {
    id: "zappi",
    name: "Zappi",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "email",    label: "MYENERGI EMAIL",    placeholder: "you@example.com",  secret: false, hint: "Your myenergi account email" },
      { key: "password", label: "MYENERGI PASSWORD", placeholder: "••••••••",         secret: true  },
      { key: "serial",   label: "ZAPPI SERIAL",      placeholder: "XXXXXXXXXX",       secret: false, hint: "Printed on the front of your Zappi unit" },
    ],
  },
  {
    id: "tesla",
    name: "Tesla",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [],
    oauth: true,
  },
  {
    id: "easee",
    name: "Easee",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "email",     label: "EASEE EMAIL",     placeholder: "you@example.com", secret: false, hint: "Your Easee account email or phone number" },
      { key: "password",  label: "EASEE PASSWORD",  placeholder: "••••••••",        secret: true  },
      { key: "chargerId", label: "CHARGER ID",      placeholder: "EH123456",        secret: false, hint: "Easee app → Charger → Settings → Charger ID" },
    ],
  },
  {
    id: "hypervolt",
    name: "Hypervolt",
    status: "beta",
    badgeLabel: "⚡ Beta",
    badgeColor: "#F59E0B",
    fields: [
      { key: "apiKey",     label: "API KEY",     placeholder: "hv_xxxxxxxxxxxx",  secret: true,  hint: "Hypervolt app → Settings → API access" },
      { key: "chargerId",  label: "CHARGER ID",  placeholder: "XXXXXXXXXXXX",     secret: false, hint: "Found in the Hypervolt app under your charger" },
    ],
  },
  {
    id: "wallbox",
    name: "Wallbox",
    status: "beta",
    badgeLabel: "⚡ Beta",
    badgeColor: "#F59E0B",
    fields: [
      { key: "email",     label: "WALLBOX EMAIL",     placeholder: "you@example.com", secret: false, hint: "Your myWallbox account email" },
      { key: "password",  label: "WALLBOX PASSWORD",  placeholder: "••••••••",        secret: true  },
      { key: "chargerId", label: "CHARGER ID",        placeholder: "XXXXXXXXXX",      secret: false, hint: "myWallbox app → Charger settings → Serial number" },
    ],
  },
  {
    id: "podpoint",
    name: "Pod Point",
    status: "beta",
    badgeLabel: "⚡ Beta",
    badgeColor: "#F59E0B",
    fields: [
      { key: "email",  label: "POD POINT EMAIL",    placeholder: "you@example.com", secret: false, hint: "Your Pod Point account email" },
      { key: "password", label: "POD POINT PASSWORD", placeholder: "••••••••",      secret: true  },
      { key: "unitId", label: "UNIT ID",            placeholder: "XXXXXXXX",        secret: false, hint: "Pod Point app → Home Charger → Unit ID" },
    ],
  },
  {
    id: "indra",
    name: "Indra",
    status: "beta",
    badgeLabel: "⚡ Beta",
    badgeColor: "#F59E0B",
    fields: [
      { key: "email",    label: "INDRA EMAIL",     placeholder: "you@example.com", secret: false, hint: "Your Indra account email" },
      { key: "password", label: "INDRA PASSWORD",  placeholder: "••••••••",        secret: true },
      { key: "deviceId", label: "DEVICE ID",       placeholder: "indra-001",       secret: false, hint: "From the Indra app or installer portal" },
    ],
  },
];

const V2H_SUPPORTED_EV_BRANDS = new Set(["wallbox", "indra"]);
const DEFAULT_V2H_MIN_SOC_PERCENT = 30;

// ── FIELD COMPONENT ───────────────────────────────────────────────────────
function Field({ label, placeholder, hint, link, value, onChange, secret, type }: {
  label: string; placeholder: string; hint?: string; link?: { text: string; url: string };
  value: string; onChange: (v: string) => void; secret?: boolean; type?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={secret ? (show ? "text" : "password") : (type ?? "text")}
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

function CredentialReassurance({ variant }: { variant: "api" | "device" }) {
  const message =
    variant === "api"
      ? "Read-only access only — Aveum cannot make payments or change your tariff."
      : "Aveum uses your credentials to send optimisation commands only. We never store passwords in plain text.";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#0F1923", border: "1px solid #1F2937", borderRadius: 8, padding: "10px 12px", marginTop: 4, marginBottom: 12 }}>
      <Lock size={13} color="#6B7280" style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <span style={{ fontSize: 11, color: "#9CA3AF", lineHeight: "1.5" }}>{message}{" "}</span>
        <a href="/privacy" style={{ fontSize: 11, color: "#6B7280", textDecoration: "none" }}>How we protect your data →</a>
      </div>
    </div>
  );
}

// ── OCTOPUS FORM ──────────────────────────────────────────────────────────
const UK_REGIONS = [
  { value: "A", label: "East England" },
  { value: "B", label: "East Midlands" },
  { value: "C", label: "London" },
  { value: "D", label: "North West" },
  { value: "E", label: "North East" },
  { value: "F", label: "South East" },
  { value: "G", label: "South West" },
  { value: "H", label: "South Wales" },
  { value: "J", label: "Scotland" },
  { value: "K", label: "West Midlands" },
  { value: "L", label: "Yorkshire" },
];

const TARIFF_OPTIONS = [
  { value: "octopus_agile", label: "Octopus Agile", description: "recommended — half-hourly dynamic prices" },
  { value: "octopus_go", label: "Octopus Go", description: "cheap overnight 11:30pm–5:30am at fixed rate" },
  { value: "octopus_intelligent_go", label: "Octopus Intelligent Go", description: "Octopus controls EV directly" },
  { value: "eon_drive", label: "E.ON Drive", description: "cheap overnight 12am–7am" },
  { value: "edf_goelectric", label: "EDF GoElectric", description: "cheap overnight 12am–7am" },
  { value: "british_gas_electric_driver", label: "British Gas Electric Driver", description: "cheap overnight 12am–8am" },
  { value: "other_smart", label: "Other smart tariff", description: "I'll enter my cheap window manually" },
  { value: "standard_fixed", label: "Standard fixed tariff", description: "no smart tariff" },
] as const;

function OctopusForm({ creds, setCreds, skipped, onSkip, onUnskip }: { creds: any; setCreds: any; skipped: boolean; onSkip: () => void; onUnskip: () => void }) {
  const tariffType = creds.tariffType || "octopus_agile";
  const isOctopusTariff = tariffType === "octopus_agile" || tariffType === "octopus_go" || tariffType === "octopus_intelligent_go";
  const isOtherSmartTariff = tariffType === "other_smart";
  const isStandardFixedTariff = tariffType === "standard_fixed";

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Grid3X3 size={16} color="#A78BFA" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>Octopus Energy</span>
      </div>

      {/* Tariff selector */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>YOUR TARIFF</label>
        <select
          value={tariffType}
          onChange={e => setCreds((c: any) => ({ ...c, tariffType: e.target.value }))}
          style={{ width: "100%", background: "#111827", border: "1px solid #374151", borderRadius: 10, padding: "11px 14px", color: "#F9FAFB", fontSize: 13, fontFamily: "inherit", outline: "none", appearance: "none", cursor: "pointer" }}
        >
          {TARIFF_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label} ({option.description})</option>
          ))}
        </select>
        <div style={{ marginTop: 6, textAlign: "right" }}>
          <a
            href="/why-agile"
            style={{ fontSize: 11, color: "#93C5FD", textDecoration: "none" }}
          >
            Why Agile?
          </a>
        </div>
      </div>

      {!isOctopusTariff && (
        <div style={{ background: "#0B1725", border: "1px solid #1E3A5F", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>
            Switch to Octopus Agile and save more
          </div>
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: "0 0 10px", lineHeight: 1.5 }}>
            Octopus Agile gives Aveum half-hourly prices to optimise against — unlocking the full saving and earning potential. Most users save an extra £200-400/year by switching.
          </p>
          <a
            href="https://share.octopus.energy/aveum"
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", background: "#22C55E", color: "#030712", fontSize: 12, fontWeight: 800, textDecoration: "none", padding: "9px 12px", borderRadius: 8 }}
          >
            Switch to Octopus Agile →
          </a>
          <p style={{ fontSize: 11, color: "#6B7280", margin: "8px 0 0" }}>
            Takes 5 minutes. No engineer visit needed.
          </p>
        </div>
      )}

      {/* Region selector — always shown */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>YOUR REGION</label>
        <select
          value={creds.region || "C"}
          onChange={e => setCreds((c: any) => ({ ...c, region: e.target.value }))}
          style={{ width: "100%", background: "#111827", border: "1px solid #374151", borderRadius: 10, padding: "11px 14px", color: "#F9FAFB", fontSize: 13, fontFamily: "inherit", outline: "none", appearance: "none", cursor: "pointer" }}
        >
          {UK_REGIONS.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {!isOctopusTariff ? (
        <div style={{ background: "#0D1521", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
            Aveum will use the standard cheap window for your tariff automatically.
          </p>
          {isOtherSmartTariff && (
            <div style={{ marginTop: 12 }}>
              <Field
                label="CHEAP RATE STARTS"
                placeholder=""
                hint="Enter your off-peak start time"
                secret={false}
                type="time"
                value={creds.cheapRateStart ?? "00:00"}
                onChange={v => setCreds((c: any) => ({ ...c, cheapRateStart: v }))}
              />
              <Field
                label="CHEAP RATE ENDS"
                placeholder=""
                hint="Enter your off-peak end time"
                secret={false}
                type="time"
                value={creds.cheapRateEnd ?? "07:00"}
                onChange={v => setCreds((c: any) => ({ ...c, cheapRateEnd: v }))}
              />
            </div>
          )}
          {isStandardFixedTariff && (
            <p style={{ fontSize: 12, color: "#9CA3AF", margin: "10px 0 0", lineHeight: 1.5 }}>
              Aveum works best with a smart tariff. Your devices will still be optimised but savings will be smaller.
            </p>
          )}
        </div>
      ) : (
        skipped ? (
          <div style={{ background: "#0D1521", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
            <p style={{ fontSize: 12, color: "#6B7280", margin: "0 0 8px", lineHeight: 1.5 }}>
              Aveum will use public Octopus Agile rates for your region — you can add your API key later for personalised data.
            </p>
            <button onClick={onUnskip} style={{ background: "none", border: "none", color: "#A78BFA", fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
              Add API key instead →
            </button>
          </div>
        ) : (
          <>
            <Field label="ACCESS KEY" placeholder="octopus_access_xxxxxxxxx" hint="Account → Personal details → API access" link={{ text: "Open Octopus", url: "https://octopus.energy/dashboard/new/accounts/personal-details/" }} value={creds.apiKey} onChange={v => setCreds((c: any) => ({ ...c, apiKey: v }))} secret /> {/* // gitleaks:allow */}
            <Field label="ACCOUNT NUMBER" placeholder="A-XXXXXXXX" hint="Format: A- followed by 8 characters" value={creds.accountNumber} onChange={v => setCreds((c: any) => ({ ...c, accountNumber: v }))} />
            <CredentialReassurance variant="api" />
            <button onClick={onSkip} style={{ background: "none", border: "none", color: "#4B5563", fontSize: 12, cursor: "pointer", padding: "2px 0 8px", fontFamily: "inherit", display: "block" }}>
              Skip for now
            </button>
          </>
        )
      )}
    </div>
  );
}

// ── SOLAR / BATTERY FORM ──────────────────────────────────────────────────
const INVERTER_BRANDS = [
  {
    id: "givenergy",
    name: "GivEnergy",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-givenergy-api-key", secret: true, hint: "givenergy.cloud → Account Details → Generate API Key", link: { text: "Open GivEnergy", url: "https://givenergy.cloud" } },
      { key: "serial", label: "INVERTER SERIAL NUMBER", placeholder: "SA2XXXXXXXXXX", secret: false, hint: "On the sticker on your inverter or in the app" },
    ],
  },
  {
    id: "solax",
    name: "Solax",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "tokenId", label: "TOKEN ID", placeholder: "20240XXXXXXXXXXX", secret: true, hint: "solaxcloud.com → Support → Third-party Ecology" },
      { key: "wifiSn", label: "WIFI DONGLE SERIAL", placeholder: "SUT****VB1", secret: false, hint: "Registration number shown in Solax Cloud under your inverter" },
    ],
  },
  {
    id: "solarEdge",
    name: "SolarEdge",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-solaredge-api-key", secret: true, hint: "monitoring.solaredge.com → Admin → Site Access → API Access" },
      { key: "siteId", label: "SITE ID", placeholder: "XXXXXXX", secret: false, hint: "Shown in the URL of your SolarEdge monitoring portal" },
    ],
  },
  {
    id: "solis",
    name: "Solis",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "apiKey", label: "API KEY", placeholder: "your-solis-api-key", secret: true },
      { key: "apiSecret", label: "API SECRET", placeholder: "your-solis-api-secret", secret: true, hint: "Solis Cloud → Account → API Management" },
      { key: "stationId", label: "STATION ID", placeholder: "XXXXXXXXXX", secret: false },
    ],
  },
  {
    id: "foxess",
    name: "Fox ESS",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "apiKey", label: "FOX ESS API KEY", placeholder: "your-foxess-api-key", secret: true },
      { key: "deviceSn", label: "DEVICE SERIAL", placeholder: "SNXXXXXXXX", secret: false },
    ],
  },
  {
    id: "huawei",
    name: "Huawei FusionSolar",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "username", label: "FUSIONSOLAR USERNAME", placeholder: "your_fusionsolar_username", secret: false },
      { key: "systemCode", label: "SYSTEM CODE", placeholder: "your_system_code", secret: true, hint: "Provided in Huawei FusionSolar account settings" },
    ],
  },
  {
    id: "ecoflow",
    name: "EcoFlow",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "accessKey", label: "ACCESS KEY", placeholder: "your-ecoflow-access-key", secret: true },
      { key: "secretKey", label: "SECRET KEY", placeholder: "your-ecoflow-secret-key", secret: true },
      { key: "deviceSn", label: "DEVICE SERIAL", placeholder: "R33**********", secret: false },
    ],
  },
  {
    id: "libbi",
    name: "myenergi Libbi",
    status: "supported",
    badgeLabel: "✓ Supported",
    badgeColor: "#22C55E",
    fields: [
      { key: "email", label: "MYENERGI EMAIL", placeholder: "you@example.com", secret: false },
      { key: "password", label: "MYENERGI PASSWORD", placeholder: "••••••••", secret: true },
      { key: "serial", label: "LIBBI SERIAL", placeholder: "LXXXXXXXXX", secret: false },
    ],
  },
  {
    id: "sigenergy",
    name: "Sigenergy",
    status: "beta",
    badgeLabel: "⚡ Beta",
    badgeColor: "#F59E0B",
    fields: [],
  },
  {
    id: "growatt",
    name: "Growatt",
    status: "coming_soon",
    badgeLabel: "Coming soon",
    badgeColor: "#6B7280",
    fields: [],
  },
  {
    id: "sunsynk",
    name: "Sunsynk",
    status: "coming_soon",
    badgeLabel: "Coming soon",
    badgeColor: "#6B7280",
    fields: [],
  },
  {
    id: "sofar",
    name: "Sofar Solar",
    status: "coming_soon",
    badgeLabel: "Coming soon",
    badgeColor: "#6B7280",
    fields: [],
  },
];

function SolarBatteryForm({ creds, setCreds, hasSolar, hasBattery }: { creds: any; setCreds: any; hasSolar: boolean; hasBattery: boolean }) {
  const [brand, setBrand] = useState<string>(creds.brand || "");
  const selectedBrand = INVERTER_BRANDS.find(b => b.id === brand);
  const showComingSoon = selectedBrand?.status === "coming_soon";
  const showBeta = selectedBrand?.status === "beta";

  const handleBrandSelect = (id: string) => {
    setBrand(id);
    setCreds({ brand: id });
  };

  const title = hasSolar && hasBattery ? "Solar & Battery" : hasBattery ? "Home Battery" : "Solar Inverter";

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Sun size={16} color="#F59E0B" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>{title}</span>
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
            <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, color: b.badgeColor, background: `${b.badgeColor}20`, border: `1px solid ${b.badgeColor}33`, borderRadius: 999, padding: "2px 6px" }}>
              {b.badgeLabel}
            </div>
          </button>
        ))}
      </div>
      {showComingSoon && selectedBrand && (
        <div style={{ background: "#0D1521", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: 0, lineHeight: 1.5 }}>
            We&apos;re building {selectedBrand.name} support — sign up and we&apos;ll notify you when it&apos;s ready.
          </p>
        </div>
      )}
      {showBeta && (
        <div style={{ background: "#221A0D", border: "1px solid #92400E", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "#F59E0B", margin: 0, lineHeight: 1.5 }}>
            Beta integration — functional but less tested. We&apos;d love your feedback.
          </p>
        </div>
      )}
      {selectedBrand && !showComingSoon && (
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
  const selectedBrand = EV_BRANDS.find((b) => b.id === brand);
  const showComingSoon = selectedBrand?.status === "coming_soon";
  const showBeta = selectedBrand?.status === "beta";
  const supportsV2h = V2H_SUPPORTED_EV_BRANDS.has(brand);

  const handleBrandSelect = (id: string) => {
    setBrand(id);
    const nextSupportsV2h = V2H_SUPPORTED_EV_BRANDS.has(id);
    setCreds((c: any) => ({
      ...c,
      brand: id,
      departureTime: c.departureTime,
      targetSocPercent: c.targetSocPercent,
      v2hCapable: nextSupportsV2h ? Boolean(c.v2hCapable) : false,
      v2hMinSocPercent: nextSupportsV2h
        ? c.v2hMinSocPercent ?? DEFAULT_V2H_MIN_SOC_PERCENT
        : DEFAULT_V2H_MIN_SOC_PERCENT,
    }));
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Zap size={16} color="#38BDF8" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F9FAFB" }}>EV Charger</span>
      </div>

      <Field
        label="WHAT TIME DO YOU USUALLY LEAVE?"
        placeholder=""
        hint=""
        secret={false}
        type="time"
        value={creds.departureTime ?? "08:00"}
        onChange={(v) => setCreds((c: any) => ({ ...c, departureTime: v }))}
      />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 6, letterSpacing: 0.5 }}>
          HOW MUCH CHARGE DO YOU WANT BY THEN?
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={20}
            max={100}
            value={creds.targetSocPercent ?? 80}
            onChange={(e) => setCreds((c: any) => ({ ...c, targetSocPercent: Math.min(100, Math.max(20, Number(e.target.value))) }))}
            style={{ flex: 1, background: "#111827", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", color: "#F9FAFB", fontSize: 14, fontFamily: "inherit", outline: "none" }}
          />
          <span style={{ fontSize: 14, fontWeight: 700, color: "#9CA3AF" }}>%</span>
        </div>
      </div>

      <p style={{ fontSize: 11, color: "#4B5563", marginTop: -8, marginBottom: 18, lineHeight: 1.5 }}>
        Aveum uses these to guarantee your car is ready when you need it.
      </p>

      {supportsV2h && (
        <div style={{ background: "#0D1521", border: "1px solid #38BDF830", borderRadius: 12, padding: "16px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 4, letterSpacing: 0.5 }}>
                VEHICLE TO HOME
              </div>
              <div style={{ fontSize: 12, color: "#D1D5DB", lineHeight: 1.5 }}>
                My charger supports V2H (bidirectional charging).
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setCreds((c: any) => ({
                  ...c,
                  v2hCapable: !c.v2hCapable,
                  v2hMinSocPercent: c.v2hMinSocPercent ?? DEFAULT_V2H_MIN_SOC_PERCENT,
                }))
              }
              style={{
                width: 50,
                height: 30,
                borderRadius: 999,
                border: "none",
                background: creds.v2hCapable ? "#22C55E" : "#374151",
                position: "relative",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: creds.v2hCapable ? 24 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#F9FAFB",
                  transition: "left 0.15s ease",
                }}
              />
            </button>
          </div>

          {creds.v2hCapable && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: 0.5 }}>
                  MINIMUM CHARGE TO KEEP
                </label>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#38BDF8" }}>
                  {creds.v2hMinSocPercent ?? DEFAULT_V2H_MIN_SOC_PERCENT}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={60}
                step={5}
                value={creds.v2hMinSocPercent ?? DEFAULT_V2H_MIN_SOC_PERCENT}
                onChange={(e) =>
                  setCreds((c: any) => ({
                    ...c,
                    v2hMinSocPercent: Number(e.target.value),
                  }))
                }
                style={{ width: "100%", accentColor: "#38BDF8", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4B5563", marginTop: 4 }}>
                <span>20%</span>
                <span>40%</span>
                <span>60%</span>
              </div>
              <p style={{ fontSize: 11, color: "#9CA3AF", margin: "10px 0 0", lineHeight: 1.5 }}>
                Aveum will never discharge your EV below this level.
              </p>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 8, letterSpacing: 0.5 }}>SELECT YOUR CHARGER BRAND</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {EV_BRANDS.map((b) => (
          <button
            key={b.id}
            onClick={() => handleBrandSelect(b.id)}
            style={{
              background: brand === b.id ? "#38BDF820" : "#111827",
              border: `2px solid ${brand === b.id ? "#38BDF8" : "#374151"}`,
              borderRadius: 10,
              padding: "10px 12px",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: brand === b.id ? "#38BDF8" : "#F9FAFB", marginBottom: 4 }}>{b.name}</div>
            <div style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, color: b.badgeColor, background: `${b.badgeColor}20`, border: `1px solid ${b.badgeColor}33`, borderRadius: 999, padding: "2px 6px" }}>
              {b.badgeLabel}
            </div>
          </button>
        ))}
      </div>

      {showComingSoon && selectedBrand && (
        <div style={{ background: "#0D1521", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: 0, lineHeight: 1.5 }}>
            We&apos;re building {selectedBrand.name} support — sign up and we&apos;ll notify you when it&apos;s ready.
          </p>
        </div>
      )}

      {showBeta && (
        <div style={{ background: "#221A0D", border: "1px solid #92400E", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: "#F59E0B", margin: 0, lineHeight: 1.5 }}>
            Beta integration — functional but less tested. We&apos;d love your feedback.
          </p>
        </div>
      )}

      {brand === "tesla" && !showComingSoon && (
        <div style={{ background: "#0D1521", border: "1px solid #38BDF830", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 12, lineHeight: 1.5 }}>
            Tap below to log in with your Tesla account. You&apos;ll be redirected back automatically.
          </div>
          <button
            onClick={() => (window.location.href = "/api/tesla?action=auth")}
            style={{ width: "100%", background: "#38BDF8", border: "none", borderRadius: 10, padding: "12px 16px", color: "#030712", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Connect Tesla Account
          </button>
        </div>
      )}

      {selectedBrand && !selectedBrand.oauth && !showComingSoon && (
        <div>
          {selectedBrand.fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              placeholder={field.placeholder}
              hint={field.hint}
              secret={field.secret}
              value={creds[field.key] || ""}
              onChange={(v) => setCreds((c: any) => ({ ...c, [field.key]: v }))}
            />
          ))}
          {selectedBrand.note && (
            <p style={{ fontSize: 11, color: "#4B5563", marginTop: 6, lineHeight: 1.5 }}>{selectedBrand.note}</p>
          )}
          {selectedBrand.fields.length > 0 && <CredentialReassurance variant="device" />}
        </div>
      )}
    </div>
  );
}

// ── SAVINGS ESTIMATE ─────────────────────────────────────────────────────
function computeSavingsEstimate(selected: string[]): { low: number; high: number } | null {
  const hasSolar   = selected.includes("solar");
  const hasBattery = selected.includes("battery");
  const hasEV      = selected.includes("ev");

  if (!hasSolar && !hasBattery && !hasEV) return null;
  if (hasSolar && hasBattery && hasEV)   return { low: 1200, high: 1900 };
  if (hasSolar && hasBattery)            return { low: 900,  high: 1200 };
  if (hasSolar && hasEV)                 return { low: 700,  high: 1100 };
  if (hasBattery && hasEV)               return { low: 900,  high: 1400 };
  if (hasSolar)                          return { low: 300,  high: 500  };
  if (hasBattery)                        return { low: 500,  high: 800  };
  if (hasEV)                             return { low: 400,  high: 600  };
  return null;
}

// ── COMPLETION MESSAGE ─────────────────────────────────────────────────────
function buildCompletionMessage(selected: string[]): string {
  const hasEV      = selected.includes("ev");
  const hasSolar   = selected.includes("solar");
  const hasBattery = selected.includes("battery");

  if (hasEV && hasSolar && hasBattery)
    return "Aveum will orchestrate your whole system — solar feeds the battery, your EV charges in the cheapest window, and surplus is exported at peak prices.";
  if (hasSolar && hasBattery)
    return "Aveum will charge your battery from solar when it's available, top it up overnight from the grid at the cheapest rate, and discharge at peak price times.";
  if (hasEV && hasBattery)
    return "Aveum will charge your battery and EV in the cheapest overnight windows, then discharge the battery during peak price times to cut your bills.";
  if (hasEV && hasSolar)
    return "Aveum will route your solar directly into your EV during the day and top it up from the grid in the cheapest overnight window.";
  if (hasEV)
    return "Aveum will charge your EV in the cheapest overnight window and make sure it's ready when you need it.";
  if (hasSolar)
    return "Aveum will track your solar generation and show you the best times to run appliances or export surplus to the grid.";
  if (hasBattery)
    return "Aveum will charge your battery when energy is cheapest and discharge it during peak price windows to cut your bills.";
  return "Aveum will track Agile prices in real time and optimise your energy use to keep your bills as low as possible.";
}

// ── MAIN ──────────────────────────────────────────────────────────────────
interface OnboardingProps {
  onComplete?: (devices: string[], creds: any) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Onboarding({ onComplete }: OnboardingProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [userName, setUserName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [octopusCreds, setOctopusCreds] = useState({
    apiKey: "",
    accountNumber: "",
    region: "C",
    tariffType: "octopus_agile",
    cheapRateStart: "",
    cheapRateEnd: "",
  });
  const [octopusSkipped, setOctopusSkipped] = useState(false);
  const [solarCreds, setSolarCreds] = useState({ apiKey: "", serial: "" });
  const [evCreds, setEvCreds] = useState<any>({ brand: "" });

  const toggleDevice = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const totalSavings = DEVICES.filter(d => selected.includes(d.id)).reduce((sum, d) => sum + parseInt(d.saves), 0);
  const hasSolar   = selected.includes("solar");
  const hasBattery = selected.includes("battery");
  const hasEV      = selected.includes("ev");
  const savingsEstimate = computeSavingsEstimate(selected);
  const needsOctopus = selected.length > 0; // Agile pricing is useful for all device combos
  const needsSolar = hasSolar || hasBattery;
  const needsEV    = hasEV;

  const emailValid = EMAIL_RE.test(notifyEmail.trim());
  const profileComplete = userName.trim().length > 0 && emailValid;
  const emailError = emailTouched && notifyEmail.trim().length > 0 && !emailValid;
  const [registering, setRegistering] = useState(false);

  const handleComplete = async () => {
    setRegistering(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName,
          notifyEmail,
          octopusApiKey: octopusSkipped ? undefined : octopusCreds.apiKey || undefined,
          octopusAccountNumber: octopusSkipped ? undefined : octopusCreds.accountNumber || undefined,
          region: octopusCreds.region || "C",
          tariffType: octopusCreds.tariffType || "octopus_agile",
          cheapRateStart: octopusCreds.cheapRateStart || undefined,
          cheapRateEnd: octopusCreds.cheapRateEnd || undefined,
          optimizationMode: "balanced",
          devices: selected,
          deviceConfigs: selected.includes("ev")
            ? [
                {
                  deviceId: "ev",
                  kind: "ev_charger",
                  brand: evCreds.brand || undefined,
                  v2hCapable: Boolean(evCreds.v2hCapable),
                  v2hMinSocPercent: evCreds.v2hCapable
                    ? Number(evCreds.v2hMinSocPercent ?? DEFAULT_V2H_MIN_SOC_PERCENT)
                    : undefined,
                },
              ]
            : undefined,
          ohmeEmail: evCreds.ohmeEmail ?? undefined,
          ohmePassword: evCreds.ohmePassword ?? undefined,
          departureTime: evCreds.departureTime ?? undefined,
          targetSocPercent: evCreds.targetSocPercent != null ? Number(evCreds.targetSocPercent) : undefined,
          v2hCapable: evCreds.v2hCapable != null ? Boolean(evCreds.v2hCapable) : undefined,
          v2hMinSocPercent:
            evCreds.v2hCapable && evCreds.v2hMinSocPercent != null
              ? Number(evCreds.v2hMinSocPercent)
              : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) {
          localStorage.setItem("aveum_user_id", data.userId);
          localStorage.setItem("aveum_user_name", userName.trim());
        }
      }
    } catch {
      // Registration failure is non-blocking — still proceed to dashboard
    } finally {
      setRegistering(false);
    }
    if (onComplete) onComplete(selected, { octopusCreds, solarCreds, evCreds, userName, notifyEmail });
    navigate(`/dashboard?devices=${selected.join(",")}`);
  };

  const isNextDisabled =
    (step === 1 && !profileComplete) ||
    (step === 2 && selected.length === 0);

  return (
    <div style={{ background: "linear-gradient(135deg, #111827 0%, #0F1419 100%)", minHeight: "100vh", display: "flex", flexDirection: "column", padding: "20px", color: "#F9FAFB", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto", maxWidth: 420, margin: "0 auto" }}>

      <div style={{ marginBottom: 28, marginTop: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: -0.5 }}>
          {step === 1 && "Let's get to know you"}
          {step === 2 && "What do you have?"}
          {step === 3 && "Connect your devices"}
          {step === 4 && "You're all set"}
        </h1>
        <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>
          {step === 1 && "We'll send your daily savings report here"}
          {step === 2 && "Select everything you have — we'll show you what you could earn"}
          {step === 3 && "Enter your account details — takes 2 minutes"}
          {step === 4 && `£${totalSavings}/yr unlocked and optimising`}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 28, display: "flex", gap: 6 }}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{ height: 3, flex: 1, background: s <= step ? "#22C55E" : "#1F2937", borderRadius: 2, transition: "background 0.3s ease" }} />
        ))}
      </div>

      {/* Step 1 — profile */}
      {step === 1 && (
        <div style={{ flex: 1, marginBottom: 20 }}>
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>YOUR NAME</label>
            <input
              type="text"
              placeholder="First name"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              style={{ width: "100%", background: "#111827", border: "1px solid #374151", borderRadius: 10, padding: "12px 14px", color: "#F9FAFB", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>EMAIL ADDRESS</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={notifyEmail}
              onChange={e => setNotifyEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              style={{ width: "100%", background: "#111827", border: `1px solid ${emailError ? "#EF4444" : "#374151"}`, borderRadius: 10, padding: "12px 14px", color: "#F9FAFB", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
            />
            {emailError && (
              <span style={{ fontSize: 11, color: "#EF4444", marginTop: 4, display: "block" }}>Enter a valid email address</span>
            )}
            {!emailError && (
              <span style={{ fontSize: 11, color: "#4B5563", marginTop: 4, display: "block" }}>We'll send your daily energy report here</span>
            )}
          </div>
        </div>
      )}

      {/* Step 2 — device selection */}
      {step === 2 && (
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
          <div style={{ background: "#0D1F14", border: "1px solid #16A34A40", borderRadius: 12, padding: "14px 16px", marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" as const }}>Estimated annual value with Aveum</div>
            {savingsEstimate ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#22C55E", letterSpacing: -0.5, lineHeight: 1, marginBottom: 8 }}>
                  £{savingsEstimate.low.toLocaleString()}–£{savingsEstimate.high.toLocaleString()}
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#16A34A", marginLeft: 2 }}>/yr</span>
                </div>
                <div style={{ fontSize: 11, color: "#4B5563", lineHeight: 1.5 }}>
                  Based on typical UK household on Octopus Agile. Your actual savings may be higher.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.5 }}>Select your devices to see your savings potential.</div>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — credentials */}
      {step === 3 && (
        <div style={{ flex: 1, marginBottom: 20 }}>
          <div style={{ background: "#0F1929", border: "1px solid #1E3A5F", borderRadius: 10, padding: "10px 14px", marginBottom: 20, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Lock size={13} color="#60A5FA" style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#93C5FD", lineHeight: 1.5 }}>Your credentials are encrypted and never shared. We only read data — we never make changes without your permission.</span>
          </div>

          {needsOctopus && (
            <>
              <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 12, lineHeight: 1.6 }}>
                {hasEV && !hasSolar && !hasBattery
                  ? "Aveum reads your Agile half-hourly prices to find the cheapest overnight window for your EV."
                  : hasSolar || hasBattery
                  ? "Aveum reads your Agile prices to decide when to charge, discharge, and export for maximum savings."
                  : "Aveum reads your Agile half-hourly prices to find the cheapest times to use and export energy."}
              </p>
              <OctopusForm creds={octopusCreds} setCreds={setOctopusCreds} skipped={octopusSkipped} onSkip={() => setOctopusSkipped(true)} onUnskip={() => setOctopusSkipped(false)} />
            </>
          )}

          {needsSolar && (
            <>
              <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 12, lineHeight: 1.6 }}>
                {hasSolar && hasBattery
                  ? "Aveum connects to your inverter to coordinate solar generation, battery charging, and grid export."
                  : hasBattery
                  ? "Aveum connects to your inverter to schedule battery charging in cheap windows and discharging at peak prices."
                  : "Aveum tracks your solar output to show you the best times to use, store, or export your generation."}
              </p>
              <SolarBatteryForm creds={solarCreds} setCreds={setSolarCreds} hasSolar={hasSolar} hasBattery={hasBattery} />
            </>
          )}

          {needsEV && (
            <>
              <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 12, lineHeight: 1.6 }}>
                {hasSolar || hasBattery
                  ? "Aveum schedules your EV charging in the cheapest overnight window, coordinating with your other devices."
                  : "Aveum controls your charger to find the cheapest overnight window and make sure your car is ready on time."}
              </p>
              <EVForm creds={evCreds} setCreds={setEvCreds} />
            </>
          )}

          <div style={{ background: "#120B00", border: "1px solid #78350F40", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 6 }}>⚠ Clear any existing schedules first</div>
            <p style={{ fontSize: 12, color: "#D97706", margin: "0 0 8px", lineHeight: 1.5 }}>
              If your devices have existing charging schedules, please clear them before Aveum takes over. Two schedules running simultaneously can conflict and reduce your savings.
            </p>
            <a href="/help/clear-schedules" style={{ fontSize: 12, color: "#F59E0B", textDecoration: "none" }}>
              Here&apos;s how →
            </a>
          </div>
          <button onClick={() => setStep(4)} style={{ background: "none", border: "none", color: "#4B5563", fontSize: 12, cursor: "pointer", padding: "6px 0", fontFamily: "inherit", display: "block" }}>
            Skip — use demo data instead
          </button>
        </div>
      )}

      {/* Step 4 — complete */}
      {step === 4 && (
        <div style={{ flex: 1, marginBottom: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 72, height: 72, background: "#16A34A20", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, background: "#22C55E", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>✓</div>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>Connected & optimising</h2>
          <p style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", marginBottom: 24, maxWidth: 300, lineHeight: 1.6 }}>
            {buildCompletionMessage(selected)}
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
          <div style={{ width: "100%", marginTop: 20, background: "#0B1120", border: "1px solid #1F2937", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: 0.5, marginBottom: 10 }}>WHAT TO EXPECT</div>
            {[
              "Aveum works best in winter when Agile prices are most volatile — summer savings are smaller but still real.",
              "Your first morning email arrives tomorrow — it shows exactly what Aveum did overnight and why.",
              "If nothing was optimised on a quiet night, the email will say so honestly — no invented savings.",
            ].map((point, i) => (
              <div key={i} style={{ display: "flex", gap: 8, ...(i < 2 ? { marginBottom: 8 } : {}) }}>
                <span style={{ color: "#6B7280", fontSize: 12, flexShrink: 0 }}>·</span>
                <span style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.5 }}>{point}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", gap: 10, paddingBottom: 20 }}>
        {step > 1 && (
          <button onClick={() => setStep(step - 1)} style={{ flex: 1, background: "#1F2937", border: "1px solid #374151", borderRadius: 10, padding: "13px 16px", color: "#F9FAFB", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Back</button>
        )}
        <button
          onClick={step === 4 ? handleComplete : () => setStep(step + 1)}
          disabled={isNextDisabled || registering}
          style={{ flex: 1, border: "none", borderRadius: 10, padding: "13px 16px", background: isNextDisabled || registering ? "#374151" : "#22C55E", color: isNextDisabled || registering ? "#6B7280" : "#111827", fontSize: 14, fontWeight: 700, cursor: isNextDisabled || registering ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit", transition: "background 0.15s ease, color 0.15s ease" }}
        >
          {step === 4 && registering ? "Saving…" : step === 1 ? "Continue" : step === 4 ? "Go to Dashboard" : "Next"}
          {!registering && <ChevronRight size={16} />}
        </button>
      </div>
    </div>
  );
}