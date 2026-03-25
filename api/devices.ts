// api/devices.ts — consolidated device handler
// Route: /api/devices?brand=zappi|ohme|hypervolt|wallbox|easee|podpoint|givenergy|solax
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac } from "crypto";

// ── ZAPPI ─────────────────────────────────────────────────────────────────
function buildDigestAuth(username: string, password: string, uri: string, method: string) {
  const ha1 = createHmac("md5", "").update(`${username}:myenergi:${password}`).digest("hex");
  const ha2 = createHmac("md5", "").update(`${method}:${uri}`).digest("hex");
  const nc = "00000001";
  const cnonce = Math.random().toString(36).substring(2, 10);
  const realm = "myenergi";
  const nonce = Math.random().toString(36).substring(2, 18);
  const response = createHmac("md5", "").update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`).digest("hex");
  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
}

async function handleZappi(req: VercelRequest, res: VercelResponse) {
  const email = process.env.MYENERGI_EMAIL;
  const password = process.env.MYENERGI_PASSWORD;
  const serial = process.env.ZAPPI_SERIAL;
  if (!email || !password || !serial) return res.status(500).json({ error: "MYENERGI_EMAIL, MYENERGI_PASSWORD or ZAPPI_SERIAL not set" });
  const BASE = "https://s18.myenergi.net";
  if (req.method === "GET") {
    const uri = `/cgi-jstatus-Z${serial}`;
    const data = await (await fetch(`${BASE}${uri}`, { headers: { Authorization: buildDigestAuth(email, password, uri, "GET") } })).json();
    const z = data["zappi"]?.[0] ?? data?.[0];
    const MODE_LABELS: Record<number, string> = { 1: "Fast", 2: "Eco", 3: "Eco+", 4: "Stop" };
    return res.status(200).json({ serial, chargeMode: z?.zmo ?? null, chargeModeLabel: MODE_LABELS[z?.zmo] ?? "Unknown", chargeRateW: z?.div ?? 0, status: z?.sta ?? null, voltageV: z?.vol ? z.vol / 10 : null, frequencyHz: z?.frq ? z.frq / 100 : null, todayKwh: z?.che ?? 0 });
  }
  if (req.method === "POST") {
    const { mode } = req.body;
    if (![1, 2, 3, 4].includes(mode)) return res.status(400).json({ error: "mode must be 1, 2, 3 or 4" });
    const uri = `/cgi-zappi-mode-Z${serial}-${mode}-0-0-0000`;
    await fetch(`${BASE}${uri}`, { headers: { Authorization: buildDigestAuth(email, password, uri, "GET") } });
    const MODE_LABELS: Record<number, string> = { 1: "Fast", 2: "Eco", 3: "Eco+", 4: "Stop" };
    return res.status(200).json({ success: true, mode, modeLabel: MODE_LABELS[mode] });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

// ── OHME ──────────────────────────────────────────────────────────────────
async function handleOhme(req: VercelRequest, res: VercelResponse) {
  const email = process.env.OHME_EMAIL;
  const password = process.env.OHME_PASSWORD;
  if (!email || !password) return res.status(500).json({ error: "OHME_EMAIL or OHME_PASSWORD not set" });
  const BASE = "https://api.ohme.io/v1";
  const authData = await (await fetch(`${BASE}/users/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const token = authData.token;
  const chargerUid = authData.chargeDevices?.[0]?.uid;
  if (!token || !chargerUid) return res.status(401).json({ error: "No token or charger found" });
  if (req.method === "GET") {
    const session = await (await fetch(`${BASE}/charge-sessions/ongoing?chargeDeviceUid=${chargerUid}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    return res.status(200).json({ chargerUid, isCharging: session?.mode === "SMART_CHARGE" || session?.mode === "MAX_CHARGE", chargeRateW: session?.power ?? 0, mode: session?.mode ?? "DISCONNECTED", todayKwh: session?.energyAdded ?? 0, targetSoc: session?.targetSoc ?? null });
  }
  if (req.method === "POST") {
    const { mode } = req.body;
    if (!["MAX_CHARGE", "SMART_CHARGE", "STOP_CHARGE"].includes(mode)) return res.status(400).json({ error: "Invalid mode" });
    await fetch(`${BASE}/charge-sessions/ongoing?chargeDeviceUid=${chargerUid}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    return res.status(200).json({ success: true, mode });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

// ── HYPERVOLT ─────────────────────────────────────────────────────────────
async function handleHypervolt(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.HYPERVOLT_API_KEY;
  const chargerId = process.env.HYPERVOLT_CHARGER_ID;
  if (!apiKey || !chargerId) return res.status(500).json({ error: "HYPERVOLT_API_KEY or HYPERVOLT_CHARGER_ID not set" });
  const BASE = "https://api.hypervolt.co.uk/v2";
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (req.method === "GET") {
    const data = await (await fetch(`${BASE}/charger/${chargerId}`, { headers })).json();
    return res.status(200).json({ chargerId, isCharging: data.charging ?? false, chargeRateW: data.charge_rate_watts ?? 0, todayKwh: data.today_kwh ?? 0, locked: data.locked ?? false, status: data.status ?? "unknown" });
  }
  if (req.method === "POST") {
    const { charging } = req.body;
    await fetch(`${BASE}/charger/${chargerId}/session`, { method: "POST", headers, body: JSON.stringify({ charging }) });
    return res.status(200).json({ success: true, charging });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

// ── WALLBOX ───────────────────────────────────────────────────────────────
async function handleWallbox(req: VercelRequest, res: VercelResponse) {
  const email = process.env.WALLBOX_EMAIL;
  const password = process.env.WALLBOX_PASSWORD;
  const chargerId = process.env.WALLBOX_CHARGER_ID;
  if (!email || !password || !chargerId) return res.status(500).json({ error: "WALLBOX_EMAIL, WALLBOX_PASSWORD or WALLBOX_CHARGER_ID not set" });
  const BASE = "https://api.wall-box.com";
  const authData = await (await fetch(`${BASE}/auth/token/user`, { method: "GET", headers: { Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`, "Content-Type": "application/json", Partner: "wallbox" } })).json();
  const token = authData.data?.attributes?.token;
  if (!token) return res.status(401).json({ error: "Wallbox auth failed" });
  if (req.method === "GET") {
    const data = await (await fetch(`${BASE}/v2/charger/${chargerId}/status`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } })).json();
    return res.status(200).json({ chargerId, isCharging: [193, 194, 195].includes(data.status_id), chargeRateKw: data.charging_power ?? 0, statusId: data.status_id, todayKwh: data.added_energy ?? 0 });
  }
  if (req.method === "POST") {
    const { action } = req.body;
    const actionMap: Record<string, number> = { start: 1, stop: 2, pause: 2 };
    if (!actionMap[action]) return res.status(400).json({ error: "action must be start, stop or pause" });
    await fetch(`${BASE}/v2/charger/${chargerId}/remote-action`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: actionMap[action] }) });
    return res.status(200).json({ success: true, action });
  }
  return res.status(405).json({ error: "Method not allowed" });
}

// ── EASEE ─────────────────────────────────────────────────────────────────
async function handleEasee(req: VercelRequest, res: VercelResponse) {
  const chargerId = process.env.EASEE_CHARGER_ID;
  if (!process.env.EASEE_EMAIL || !process.env.EASEE_PASSWORD || !chargerId) return res.status(200).json({ error: "EASEE credentials not set", mock: true, isCharging: false });
  const BASE = "https://api.easee.com/api";
  const tokenData = await (await fetch(`${BASE}/accounts/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userName: process.env.EASEE_EMAIL, password: process.env.EASEE_PASSWORD }) })).json();
  const token = tokenData.accessToken;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (req.method === "POST") {
    const { action } = req.body || {};
    await fetch(`${BASE}/chargers/${chargerId}/commands/${action === "start" ? "start_charging" : "stop_charging"}`, { method: "POST", headers });
    return res.status(200).json({ success: true, action });
  }
  const state = await (await fetch(`${BASE}/chargers/${chargerId}/state`, { headers })).json();
  return res.status(200).json({ chargerId, isCharging: state.chargerOpMode === 3, isConnected: state.chargerOpMode !== 1, sessionEnergy: state.sessionEnergy ?? 0, totalPower: state.totalPower ?? 0 });
}

// ── POD POINT ─────────────────────────────────────────────────────────────
async function handlePodPoint(req: VercelRequest, res: VercelResponse) {
  if (!process.env.PODPOINT_EMAIL || !process.env.PODPOINT_PASSWORD || !process.env.PODPOINT_UNIT_ID) return res.status(200).json({ error: "PODPOINT credentials not set", mock: true, isCharging: false });
  const BASE = "https://api.pod-point.com/v4";
  const authData = await (await fetch(`${BASE}/users/sign_in`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Aveum/1.0" }, body: JSON.stringify({ email: process.env.PODPOINT_EMAIL, password: process.env.PODPOINT_PASSWORD }) })).json();
  const token = authData.access_token;
  const userId = authData.id;
  const unitId = process.env.PODPOINT_UNIT_ID;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "Aveum/1.0" };
  if (req.method === "POST") {
    const { action } = req.body || {};
    if (action === "start") await fetch(`${BASE}/users/${userId}/units/${unitId}/schedules`, { method: "DELETE", headers });
    else await fetch(`${BASE}/users/${userId}/units/${unitId}/schedules`, { method: "POST", headers, body: JSON.stringify({ schedules: [{ start_time: "00:00:00", end_time: "00:00:01", status: "active" }] }) });
    return res.status(200).json({ success: true, action });
  }
  const unit = await (await fetch(`${BASE}/users/${userId}/units/${unitId}`, { headers })).json();
  const pod = unit.units?.[0];
  return res.status(200).json({ unitId, isCharging: pod?.statuses?.[0]?.key_name === "charging", isConnected: pod?.statuses?.[0]?.key_name !== "available", status: pod?.statuses?.[0]?.key_name ?? "unknown" });
}

// ── GIVENERGY ─────────────────────────────────────────────────────────────
async function handleGivEnergy(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.GIVENERGY_API_KEY;
  const serial = process.env.GIVENERGY_SERIAL;
  if (!apiKey || !serial) return res.status(500).json({ error: "GIVENERGY_API_KEY or GIVENERGY_SERIAL not set" });
  const raw = await (await fetch(`https://api.givenergy.cloud/v1/inverter/${serial}/system-data/latest`, { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } })).json();
  const d = raw.data;
  return res.status(200).json({ solar: { w: d.solar?.power ?? 0, todayKwh: d.solar?.today ?? 0 }, battery: { pct: d.battery?.percent ?? 0, w: d.battery?.power ?? 0, temperatureC: d.battery?.temperature ?? null }, grid: { w: d.grid?.power ?? 0, todayImportKwh: d.grid?.today_import ?? 0, todayExportKwh: d.grid?.today_export ?? 0 }, home: { w: d.consumption?.power ?? 0, todayKwh: d.consumption?.today ?? 0 }, timestamp: d.time ?? new Date().toISOString() });
}

// ── SOLAX ─────────────────────────────────────────────────────────────────
async function handleSolax(req: VercelRequest, res: VercelResponse) {
  const tokenId = process.env.SOLAX_TOKEN_ID;
  const wifiSn = process.env.SOLAX_WIFI_SN;
  if (!tokenId || !wifiSn) return res.status(200).json({ error: "SOLAX credentials not set", mock: true, solarW: 2840, batteryPct: 62 });
  const data = await (await fetch("https://global.solaxcloud.com/api/v2/dataAccess/realtimeInfo/get", { method: "POST", headers: { "Content-Type": "application/json", tokenId }, body: JSON.stringify({ wifiSn }) })).json();
  if (!data.success) return res.status(500).json({ error: data.exception ?? "Solax error" });
  const r = data.result;
  const solarW = (r.powerdc1 ?? 0) + (r.powerdc2 ?? 0) + (r.powerdc3 ?? 0) + (r.powerdc4 ?? 0);
  return res.status(200).json({ solarW, batteryPct: r.soc ?? 0, batteryPowerW: r.batPower ?? 0, gridPowerW: r.feedinpower ?? 0, isExporting: (r.feedinpower ?? 0) < 0, homePowerW: r.acpower ?? 0, yieldTodayKwh: r.yieldtoday ?? 0, uploadTime: r.uploadTime });
}

// ── ROUTER ────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const brand = req.query.brand as string;

  try {
    switch (brand) {
      case "zappi":      return await handleZappi(req, res);
      case "ohme":       return await handleOhme(req, res);
      case "hypervolt":  return await handleHypervolt(req, res);
      case "wallbox":    return await handleWallbox(req, res);
      case "easee":      return await handleEasee(req, res);
      case "podpoint":   return await handlePodPoint(req, res);
      case "givenergy":  return await handleGivEnergy(req, res);
      case "solax":      return await handleSolax(req, res);
      default:           return res.status(400).json({ error: `Unknown brand: ${brand}. Use ?brand=zappi|ohme|hypervolt|wallbox|easee|podpoint|givenergy|solax` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
