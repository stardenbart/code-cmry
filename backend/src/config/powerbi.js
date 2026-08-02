import axios from 'axios';

const TOKEN_URL = () =>
  `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/v2.0/token`;
const API_BASE = 'https://api.powerbi.com/v1.0/myorg';

// ── AAD Token Cache ───────────────────────────────────────────────────────────
let cachedAADToken = null;
let aadTokenExpiry = 0;

async function getAADToken() {
  if (cachedAADToken && Date.now() < aadTokenExpiry - 60_000) {
    return cachedAADToken;
  }

  const params = new URLSearchParams({
    grant_type: 'password',
    client_id:  process.env.POWERBI_CLIENT_ID,
    username:   process.env.POWERBI_MASTER_USERNAME,
    password:   process.env.POWERBI_MASTER_PASSWORD,
    scope:      'https://analysis.windows.net/powerbi/api/.default',
  });

  // Include client_secret only for confidential client registrations
  if (process.env.POWERBI_CLIENT_SECRET) {
    params.append('client_secret', process.env.POWERBI_CLIENT_SECRET);
  }

  const { data } = await axios.post(TOKEN_URL(), params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedAADToken = data.access_token;
  aadTokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedAADToken;
}

// ── Embed Token Cache (per reportId) ─────────────────────────────────────────
// All users share the same View-only embed token per report.
// Safe because: token is View-only, not tied to user identity,
// and access control is already enforced at the JWT layer in server.js.
const embedTokenCache = new Map();

async function generateEmbedConfig(reportId) {
  const cached = embedTokenCache.get(reportId);

  // Reuse cached token if still valid (with 5-minute safety buffer before expiry)
  if (cached && Date.now() < new Date(cached.tokenExpiry).getTime() - 5 * 60_000) {
    console.log(`[PowerBI] Cache hit for report: ${reportId}`);
    return {
      reportId,
      embedUrl:    cached.embedUrl,
      embedToken:  cached.embedToken,
      tokenExpiry: cached.tokenExpiry,
    };
  }

  console.log(`[PowerBI] Generating new embed token for report: ${reportId}`);

  const aadToken    = await getAADToken();
  const workspaceId = process.env.POWERBI_WORKSPACE_ID;
  const authHeader  = { Authorization: `Bearer ${aadToken}` };

  const [reportRes, tokenRes] = await Promise.all([
    axios.get(
      `${API_BASE}/groups/${workspaceId}/reports/${reportId}`,
      { headers: authHeader }
    ),
    axios.post(
      `${API_BASE}/groups/${workspaceId}/reports/${reportId}/GenerateToken`,
      { accessLevel: 'View', allowSaveAs: false },
      { headers: { ...authHeader, 'Content-Type': 'application/json' } }
    ),
  ]);

  const config = {
    reportId,
    embedUrl:    reportRes.data.embedUrl,
    embedToken:  tokenRes.data.token,
    tokenExpiry: tokenRes.data.expiration,
  };

  embedTokenCache.set(reportId, config);
  console.log(`[PowerBI] Token cached until: ${config.tokenExpiry}`);

  return config;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Used by the 4 fixed Data Center dashboards (key → env report ID)
export async function getEmbedConfig(dashboardKey) {
  const REPORT_MAP = {
    service:       process.env.POWERBI_REPORT_SERVICE,
    quality:       process.env.POWERBI_REPORT_QUALITY,
    cost:          process.env.POWERBI_REPORT_COST,
    safetysustain: process.env.POWERBI_REPORT_SAFETY,
  };
  const reportId = REPORT_MAP[dashboardKey];
  if (!reportId) throw new Error(`Unknown dashboard key: ${dashboardKey}`);
  return generateEmbedConfig(reportId);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts a bare report GUID, or a full `reportEmbed?reportId=<GUID>` URL, and
 * returns the GUID.
 *
 * Note: a `view?r=<base64>` share link is NOT convertible — its embedded `k`
 * value is a share key, not the report ID (verified: report 58's key
 * 89ca7919-… differs from its real report ID 60f4984e-…). Such values are
 * rejected so the caller gets a clear message instead of a broken request.
 */
export function extractReportGuid(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (GUID_RE.test(raw)) return raw;

  const match = raw.match(/[?&]reportId=([0-9a-f-]{36})/i);
  if (match && GUID_RE.test(match[1])) return match[1];

  return null;
}

// Used by database-managed department dashboards (direct report ID)
export async function getEmbedConfigByReportId(reportId) {
  if (!reportId) throw new Error('Report ID is required');

  const guid = extractReportGuid(reportId);
  if (!guid) {
    throw new Error(
      'Report ID tidak valid. Isi kolom "Report ID (Export Mode)" di Dashboard Manager dengan GUID report Power BI ' +
      '(contoh: 60f4984e-db53-4948-8bb3-0f6b932958c3), bukan link "view?r=..." — link publik tidak bisa dipakai ' +
      'untuk export/AI karena token di dalamnya bukan report ID.'
    );
  }

  return generateEmbedConfig(guid);
}
