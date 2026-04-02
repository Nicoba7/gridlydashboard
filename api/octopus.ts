// api/octopus.ts — consolidated Octopus endpoint
//
// Routes:
//   GET /api/octopus                   → fetch Agile half-hourly rates
//   GET /api/octopus?action=auth       → start Octopus OAuth (redirect to login)
//   GET /api/octopus?action=callback   → handle Octopus OAuth callback
//
// Replaces: api/octopus.ts, api/octopus-auth.ts, api/octopus-callback.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";

const AGILE_PRODUCT = "AGILE-FLEX-22-11-25";
const AGILE_TARIFF = "E-1R-AGILE-FLEX-22-11-25-C";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const action = req.query.action as string | undefined;

  // ── GET /api/octopus?action=auth ───────────────────────────────────────────
  if (action === "auth") {
    const clientId = process.env.OCTOPUS_CLIENT_ID;
    const redirectUri =
      process.env.OCTOPUS_REDIRECT_URI ||
      "https://gridlydashboard.vercel.app/api/octopus?action=callback";

    if (!clientId) return res.status(500).json({ error: "OCTOPUS_CLIENT_ID not set" });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
    });

    return res.redirect(`https://auth.octopus.energy/authorize?${params.toString()}`);
  }

  // ── GET /api/octopus?action=callback ───────────────────────────────────────
  if (action === "callback") {
    const { code, error } = req.query;

    if (error) return res.redirect(`/?error=octopus_auth_failed`);
    if (!code) return res.redirect(`/?error=no_code`);

    try {
      const clientId = process.env.OCTOPUS_CLIENT_ID!;
      const clientSecret = process.env.OCTOPUS_CLIENT_SECRET!;
      const redirectUri =
        process.env.OCTOPUS_REDIRECT_URI ||
        "https://gridlydashboard.vercel.app/api/octopus?action=callback";

      const tokenRes = await fetch("https://auth.octopus.energy/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.redirect(`/?error=token_exchange_failed`);

      const accountRes = await fetch("https://api.octopus.energy/v1/accounts/", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const accountData = await accountRes.json();
      const accountNumber = accountData?.results?.[0]?.number ?? "";

      // Note: octopus_token in URL is kept for parity with the original callback.
      // If you want HTTP-only cookies here too, mirror the Tesla pattern.
      const params = new URLSearchParams({
        octopus_connected: "true",
        octopus_account: accountNumber,
        octopus_token: tokens.access_token,
      });

      return res.redirect(`/dashboard?${params.toString()}`);
    } catch (err: any) {
      return res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── GET /api/octopus  (Agile rates) ───────────────────────────────────────
  try {
    const apiKey = process.env.OCTOPUS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OCTOPUS_API_KEY not set in environment" });

    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 2);

    const url =
      `https://api.octopus.energy/v1/products/${AGILE_PRODUCT}/electricity-tariffs/${AGILE_TARIFF}/standard-unit-rates/` +
      `?period_from=${from.toISOString()}&period_to=${to.toISOString()}&page_size=96`;

    const response = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}` },
    });

    if (!response.ok)
      return res.status(response.status).json({ error: "Octopus API error", status: response.status });

    const data = await response.json();
    const rates = data.results
      .map((r: any) => ({
        time: new Date(r.valid_from).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        validFrom: r.valid_from,
        validTo: r.valid_to,
        pence: parseFloat(r.value_inc_vat.toFixed(2)),
      }))
      .sort((a: any, b: any) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime());

    return res.status(200).json({
      rates,
      cheapest: rates.reduce((min: any, r: any) => (r.pence < min.pence ? r : min), rates[0]),
      peak: rates.reduce((max: any, r: any) => (r.pence > max.pence ? r : max), rates[0]),
      average: parseFloat((rates.reduce((s: number, r: any) => s + r.pence, 0) / rates.length).toFixed(2)),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

