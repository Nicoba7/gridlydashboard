const S = {
  page: {
    background: "#060A12",
    minHeight: "100vh",
    color: "#F9FAFB",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    maxWidth: 480,
    margin: "0 auto",
    padding: "0 20px",
  } as React.CSSProperties,

  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 0 24px",
  } as React.CSSProperties,

  logo: {
    fontSize: 18,
    fontWeight: 800,
    color: "#F9FAFB",
    textDecoration: "none",
    letterSpacing: -0.5,
  } as React.CSSProperties,

  back: {
    fontSize: 13,
    color: "#9CA3AF",
    textDecoration: "none",
  } as React.CSSProperties,

  heading: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -0.8,
    color: "#F9FAFB",
    marginBottom: 8,
    marginTop: 8,
    lineHeight: 1.2,
  } as React.CSSProperties,

  lastUpdated: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 26,
  } as React.CSSProperties,

  section: {
    marginBottom: 36,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#4B5563",
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    marginBottom: 10,
  } as React.CSSProperties,

  body: {
    fontSize: 14,
    color: "#D1D5DB",
    lineHeight: 1.65,
    margin: 0,
  } as React.CSSProperties,

  footer: {
    borderTop: "1px solid #111827",
    padding: "20px 0 32px",
    fontSize: 12,
    color: "#374151",
    textAlign: "center" as const,
    marginTop: 12,
  } as React.CSSProperties,
};

export default function Privacy() {
  return (
    <div style={S.page}>
      {/* Nav */}
      <nav style={S.nav}>
        <a href="/" style={S.logo}>Aveum</a>
        <a href="/" style={S.back}>← Back</a>
      </nav>

      <h1 style={S.heading}>Privacy Policy</h1>
      <div style={S.lastUpdated}>Last updated: 2 April 2026</div>

      {/* Section 1 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 1 — Introduction</div>
        <p style={S.body}>
          Aveum ("we", "us", "our") operates getaveum.com and related services. This Privacy Policy explains how we collect, use, store, and protect your personal data in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.
        </p>
      </section>

      {/* Section 2 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 2 — Data We Collect</div>
        <p style={S.body}>
          We collect the following categories of personal data: your name and email address provided during registration; device credentials including API keys, serial numbers, and account login details for third-party energy devices and services; energy usage data retrieved from connected devices and your energy supplier; and technical data including IP address and browser type collected automatically when you use our service.
        </p>
      </section>

      {/* Section 3 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 3 — Lawful Basis for Processing</div>
        <p style={S.body}>
          We process your personal data on the basis of contract performance — to deliver the energy optimisation service you have requested — and legitimate interests, specifically to improve our service and ensure its security.
        </p>
      </section>

      {/* Section 4 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 4 — How We Use Your Data</div>
        <p style={S.body}>
          We use your data solely to provide and improve the Aveum service. This includes connecting to your energy devices on your behalf, calculating optimal energy schedules, and sending you daily savings reports by email. We do not use your data for advertising or sell it to third parties under any circumstances.
        </p>
      </section>

      {/* Section 5 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 5 — Data Storage and Security</div>
        <p style={S.body}>
          Your data is stored in a London-region database operated by Upstash, Inc. All data is protected by encrypted API access. Device credentials are handled in memory only during scheduled optimisation windows and are not logged. We conduct automated secret scanning on every code change.
        </p>
      </section>

      {/* Section 6 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 6 — Data Retention</div>
        <p style={S.body}>
          We retain your personal data for as long as your account is active. Energy optimisation results are retained for 90 days on a rolling basis. You may request deletion of your account and all associated data at any time.
        </p>
      </section>

      {/* Section 7 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 7 — Your Rights</div>
        <p style={S.body}>
          Under UK GDPR you have the right to access your personal data, rectify inaccurate data, erasure of your data, restriction of processing, data portability, and to object to processing. To exercise any of these rights, contact us at hello@getaveum.com. We will respond within 30 days.
        </p>
      </section>

      {/* Section 8 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 8 — Third-Party Services</div>
        <p style={S.body}>
          We connect to third-party energy device APIs on your behalf including Octopus Energy, GivEnergy, Solax, Ohme, Tesla, myenergi, and EcoFlow. Your credentials for these services are used solely to execute scheduled device commands. We are not responsible for the privacy practices of these third-party services.
        </p>
      </section>

      {/* Section 9 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 9 — Cookies</div>
        <p style={S.body}>
          We do not use tracking or advertising cookies. We use localStorage in your browser to store your session preferences only.
        </p>
      </section>

      {/* Section 10 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 10 — Changes to This Policy</div>
        <p style={S.body}>
          We may update this policy from time to time. We will notify registered users of material changes by email. Continued use of the service after changes constitutes acceptance.
        </p>
      </section>

      {/* Section 11 */}
      <section style={S.section}>
        <div style={S.sectionTitle}>Section 11 — Contact</div>
        <p style={S.body}>Aveum, hello@getaveum.com, getaveum.com</p>
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        getaveum.com · © 2026 Aveum · Built in London
      </footer>
    </div>
  );
}
