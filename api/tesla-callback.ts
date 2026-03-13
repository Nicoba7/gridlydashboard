// api/tesla-callback.ts — Tesla OAuth callback
// Step 2: Exchange code for token
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`/?error=tesla_auth_failed`);
  }

  if (!code) {
    return res.redirect(`/?error=no_code`);
  }

  try {
    const clientId = process.env.TESLA_CLIENT_ID || process.env.VITE_TESLA_CLIENT_ID;
    const clientSecret = process.env.TESLA_CLIENT_SECRET || process.env.VITE_TESLA_CLIENT_SECRET;
    const redirectUri = process.env.TESLA_REDIRECT_URI || "https://gridlydashboard.vercel.app/api/tesla-callback";

    if (!clientId || !clientSecret) {
      return res.redirect(`/?error=tesla_env_not_set`);
    }

    // Exchange code for token
    const tokenRes = await fetch("https://auth.tesla.com/oauth2/v3/token", {
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

    if (!tokens.access_token) {
      return res.redirect(`/?error=token_exchange_failed`);
    }

    // Fetch vehicle list to confirm connection
    const vehiclesRes = await fetch("https://fleet-api.prd.eu.vn.cloud.tesla.com/api/1/vehicles", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const vehicleData = await vehiclesRes.json();
    const vehicleId = vehicleData?.response?.[0]?.id_s ?? "";

    // Redirect to dashboard with token in URL params
    // In production: store in secure session/cookie instead
    const params = new URLSearchParams({
      tesla_connected: "true",
      tesla_token: tokens.access_token,
      tesla_vehicle_id: vehicleId,
    });

    res.redirect(`/dashboard?${params.toString()}`);
  } catch (err: any) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
}