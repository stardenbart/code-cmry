export function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export const ciaTelemetryEnabled = () => envFlag("CIA_TELEMETRY_ENABLED");
export const ciaAdminAnalyticsEnabled = () => envFlag("CIA_ADMIN_ANALYTICS_ENABLED");
