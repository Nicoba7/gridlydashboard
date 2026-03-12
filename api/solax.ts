import type { VercelRequest, VercelResponse } from "@vercel/node";

// SolaX Cloud API V2
// Docs: https://global.solaxcloud.com/blue/4/user_api/2024/SolaXCloud_User_API_V2.pdf
// Rate limit: 10 requests/min, 10,000/day
// Auth: tokenId in request headers, wifiSn (WiFi dongle serial) in POST body

const BASE = "https://global.solaxcloud.com/api/v2/dataAccess/realtimeInfo/get";

// inverterStatus mapping from Solax docs
const STATUS_MAP: Record<number, string> = {
  100: "Waiting",
  101: "Checking",
  102: "Normal",
  103: "Fault",
  104: "Permanent Fault",
  105: "Updating",
  106: "EPS Check",
  107: "EPS",
  108: "Self Test",
  109: "Idle",
  110: "Standby",
  111: "Pv Wake Up Bat",
  112: "Gen Check",
  113: "Gen Run",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tokenId = process.env.SOLAX_TOKEN_ID;
  const wifiSn  = process.env.SOLAX_WIFI_SN;

  if (!tokenId || !wifiSn) {
    return res.status(200).json({
      error: "SOLAX_TOKEN_ID and SOLAX_WIFI_SN environment variables not set",
      mock: true,
      // Return mock data so the dashboard still works in demo mode
      inverterStatus: "Normal",
      solarW: 2840,
      batteryPct: 62,
      batteryPowerW: 450,       // positive = charging, negative = discharging
      gridPowerW: -420,         // negative = exporting, positive = importing
      homePowerW: 1200,
      yieldTodayKwh: 14.2,
      yieldTotalKwh: 4821.6,
      uploadTime: new Date().toISOString(),
    });
  }

  try {
    const response = await fetch(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "tokenId": tokenId,
      },
      body: JSON.stringify({ wifiSn }),
    });

    if (!response.ok) {
      throw new Error(`Solax API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Solax API returned failure: ${data.exception ?? "unknown error"}`);
    }

    const r = data.result;

    // Solar generation = sum of all DC string inputs
    const solarW = (
      (r.powerdc1 ?? 0) +
      (r.powerdc2 ?? 0) +
      (r.powerdc3 ?? 0) +
      (r.powerdc4 ?? 0)
    );

    // Battery power: positive = charging, negative = discharging
    const batteryPowerW = r.batPower ?? 0;
    const batteryPct    = r.soc ?? 0;  // state of charge %

    // Grid power: positive = importing, negative = exporting
    const gridPowerW = r.feedinpower ?? 0;
    const isExporting = gridPowerW < 0;

    // AC output to home
    const homePowerW = r.powerdc1 != null
      ? Math.max(0, solarW + batteryPowerW - Math.abs(gridPowerW))
      : (r.acpower ?? 0);

    return res.status(200).json({
      inverterStatus: STATUS_MAP[r.inverterStatus] ?? `Status ${r.inverterStatus}`,
      inverterStatusCode: r.inverterStatus,
      solarW,
      batteryPct,
      batteryPowerW,
      gridPowerW,
      isExporting,
      homePowerW,
      yieldTodayKwh:   r.yieldtoday   ?? 0,
      yieldTotalKwh:   r.yieldtotal   ?? 0,
      consumeTodayKwh: r.consumetoday ?? 0,
      uploadTime: r.uploadTime,
      wifiSn,
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
