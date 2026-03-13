// api/tesla-auth.ts — Tesla OAuth flow
// Step 1: Redirect user to Tesla login
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.TESLA_CLIENT_ID || process.env.VITE_TESLA_CLIENT_ID;
  const redirectUri = process.env.TESLA_REDIRECT_URI || "https://gridlydashboard.vercel.app/api/tesla-callback";

  if (!clientId) {
    return res.status(500).json({ error: "TESLA_CLIENT_ID not set" });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid offline_access user_data vehicle_device_data vehicle_charging_cmds",
  });

  return res.redirect(`https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`);
}
