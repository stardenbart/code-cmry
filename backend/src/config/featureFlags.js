export function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export const ciaTelemetryEnabled = () => envFlag("CIA_TELEMETRY_ENABLED");
export const ciaAdminAnalyticsEnabled = () => envFlag("CIA_ADMIN_ANALYTICS_ENABLED");
export const ciaKpiLibraryEnabled = () => envFlag("CIA_KPI_LIBRARY_ENABLED");
export const ciaOrchestratorWebEnabled = () => envFlag("CIA_ORCHESTRATOR_WEB_ENABLED");
export const ciaHybridQueryEnabled = () => envFlag("CIA_HYBRID_QUERY_ENABLED");
export const ciaHybridWebEnabled = () => ciaHybridQueryEnabled();
