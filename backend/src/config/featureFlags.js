export function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export const ciaTelemetryEnabled = () => envFlag("CIA_TELEMETRY_ENABLED");
export const ciaAdminAnalyticsEnabled = () => envFlag("CIA_ADMIN_ANALYTICS_ENABLED");
export const ciaKpiLibraryEnabled = () => envFlag("CIA_KPI_LIBRARY_ENABLED");
export const ciaHybridQueryEnabled = () => envFlag("CIA_HYBRID_QUERY_ENABLED");
// Dashboard + Multi-Chat share one Orchestrator with no separate "orchestrator
// on, hybrid off" mode — the orchestrator IS the hybrid intent/context/
// blueprint pipeline for web. So CIA_HYBRID_QUERY_ENABLED is the single web
// gate; there used to be a second flag (CIA_ORCHESTRATOR_WEB_ENABLED) but it
// had no consumer left and was removed rather than kept dead. WhatsApp uses
// the same CIA_HYBRID_QUERY_ENABLED gate directly (see whatsappListener.js).
export const ciaHybridWebEnabled = () => ciaHybridQueryEnabled();
export const ciaKpiLibraryReadEnabled = () => ciaHybridQueryEnabled() || ciaKpiLibraryEnabled();
