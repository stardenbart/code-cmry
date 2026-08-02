import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'jwt_secret_key';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// ── Token helpers ─────────────────────────────────────────────────────────────

export function verifyApprovalToken(token) {
  return jwt.verify(token, SECRET());
}

// Token for dashboard access approve/reject (carries requestId)
function makeAccessToken(requestId) {
  return jwt.sign({ requestId, type: 'access' }, SECRET(), { expiresIn: '7d' });
}

// Token for user registration approve/reject (carries userId)
function makeUserToken(userId) {
  return jwt.sign({ userId, type: 'user' }, SECRET(), { expiresIn: '7d' });
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const BLUE   = '#1B3A6F';
const RED    = '#E63946';
const GRAD   = `linear-gradient(135deg, ${BLUE} 0%, ${RED} 100%)`;
const BG     = '#F0F2F5';
const MUTED  = '#6B7280';
const BORDER = '#E5E7EB';

// ── Base email layout ─────────────────────────────────────────────────────────
function baseLayout(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:36px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);max-width:580px;">

        <!-- Header -->
        <tr>
          <td style="background:${GRAD};padding:28px 36px 24px;text-align:center;">
            <p style="margin:0 0 4px;color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:4px;text-transform:uppercase;">
              PT. Cisarua Mountain Dairy
            </p>
            <p style="margin:0;color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:2px;">
              CODE
            </p>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.80);font-size:12px;letter-spacing:.5px;">
              Cimory Operational Digital Enhancement
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:32px 36px;">${bodyHtml}</td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F8F9FA;padding:16px 36px;text-align:center;border-top:1px solid ${BORDER};">
            <p style="margin:0;color:#ADB5BD;font-size:11px;">
              &copy; ${new Date().getFullYear()} CMD Plant Sentul &nbsp;&bull;&nbsp; Digital Transformation Division
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Reusable: two-column info table ──────────────────────────────────────────
function infoTable(rows) {
  const cells = rows.map(([label, value, highlight], i) => {
    const bg   = i % 2 === 0 ? '#F8FAFC' : '#ffffff';
    const top  = i > 0 ? `border-top:1px solid ${BORDER};` : '';
    const val  = highlight
      ? `<span style="color:${highlight};font-weight:bold;">${value}</span>`
      : value;
    return `
      <tr style="background:${bg};">
        <td style="padding:11px 16px;color:${MUTED};font-size:12px;width:130px;${top}">${label}</td>
        <td style="padding:11px 16px;font-size:13px;color:#111827;${top}">${val}</td>
      </tr>`;
  }).join('');

  return `
    <table cellpadding="0" cellspacing="0" role="presentation"
           style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin:20px 0;">
      ${cells}
    </table>`;
}

// ── Reusable: action buttons (approve | reject) ───────────────────────────────
function actionButtons(approveUrl, rejectUrl) {
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;">
      <tr>
        <td style="padding-right:12px;">
          <a href="${approveUrl}"
             style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;
                    padding:13px 32px;border-radius:8px;font-size:14px;font-weight:bold;
                    letter-spacing:.4px;">
            &#10003; &nbsp;Approve
          </a>
        </td>
        <td>
          <a href="${rejectUrl}"
             style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;
                    padding:13px 32px;border-radius:8px;font-size:14px;font-weight:bold;
                    letter-spacing:.4px;">
            &#10007; &nbsp;Reject
          </a>
        </td>
      </tr>
    </table>`;
}

function expiryNote(text) {
  return `<p style="color:#9CA3AF;font-size:11px;text-align:center;margin:20px 0 0;">${text}</p>`;
}

// ── Access-request email → dashboard PICs ─────────────────────────────────────
export async function sendAccessRequestEmail({ picEmails, requesterName, requesterDept, dashboardTitle, requestId }) {
  const token      = makeAccessToken(requestId);
  const approveUrl = `${process.env.BACKEND_URL}/api/approve-via-email?token=${token}`;
  const rejectUrl  = `${process.env.BACKEND_URL}/api/reject-via-email?token=${token}`;

  const body = `
    <h2 style="color:${BLUE};margin:0 0 6px;font-size:20px;">Dashboard Access Request</h2>
    <p style="color:${MUTED};margin:0 0 4px;font-size:13px;">
      A team member is requesting access to a dashboard you manage.
      Please review the details below and take action.
    </p>
    ${infoTable([
      ['Requester',  requesterName,  BLUE],
      ['Department', requesterDept,  null],
      ['Dashboard',  dashboardTitle, RED],
    ])}
    ${actionButtons(approveUrl, rejectUrl)}
    ${expiryNote('Buttons expire in 7 days &nbsp;&bull;&nbsp; If you did not expect this request, you may safely ignore this email.')}`;

  const recipients = picEmails.filter(e => e && e.trim()).join(', ');
  if (!recipients) return;

  await transporter.sendMail({
    from:    `"CODE Notifications" <${process.env.EMAIL_FROM}>`,
    to:      recipients,
    subject: `[Access Request] ${dashboardTitle} — ${requesterName} (${requesterDept})`,
    html:    baseLayout(body),
  });
}

// ── Registration email → superuser ────────────────────────────────────────────
export async function sendRegistrationEmail({ id, nama, departemen, email, nik }) {
  const token      = makeUserToken(id);
  const approveUrl = `${process.env.BACKEND_URL}/api/approve-user-via-email?token=${token}`;
  const rejectUrl  = `${process.env.BACKEND_URL}/api/reject-user-via-email?token=${token}`;

  const body = `
    <h2 style="color:${BLUE};margin:0 0 6px;font-size:20px;">New User Registration</h2>
    <p style="color:${MUTED};margin:0 0 4px;font-size:13px;">
      A new employee has registered on the CODE platform and is awaiting your approval.
    </p>
    ${infoTable([
      ['Full Name',   nama,       BLUE],
      ['Department',  departemen, null],
      ['Email',       email,      null],
      ['NIK',         nik,        null],
    ])}
    ${actionButtons(approveUrl, rejectUrl)}
    ${expiryNote('Buttons expire in 7 days &nbsp;&bull;&nbsp; Rejecting will permanently remove this registration.')}`;

  await transporter.sendMail({
    from:    `"CODE Notifications" <${process.env.EMAIL_FROM}>`,
    to:      process.env.SUPERUSER_EMAIL,
    subject: `[New Registration] ${nama} — ${departemen}`,
    html:    baseLayout(body),
  });
}

// ── Browser response pages ────────────────────────────────────────────────────

function responsePage({ icon, iconBg, title, titleColor, lines, badge, badgeColor, badgeBg }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:${BG};font-family:Arial,Helvetica,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;}
    .card{background:#fff;border-radius:16px;overflow:hidden;max-width:440px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.10);}
    .header{background:${GRAD};padding:24px 32px;text-align:center;}
    .header-sub{color:rgba(255,255,255,.65);font-size:10px;letter-spacing:4px;text-transform:uppercase;margin-bottom:4px;}
    .header-title{color:#fff;font-size:20px;font-weight:bold;letter-spacing:2px;}
    .body{padding:40px 32px;text-align:center;}
    .icon{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 20px;background:${iconBg};}
    h1{color:${titleColor};font-size:22px;font-weight:bold;margin-bottom:10px;}
    p{color:${MUTED};font-size:14px;line-height:1.6;margin-bottom:6px;}
    .badge{display:inline-block;background:${badgeBg};color:${badgeColor};padding:4px 16px;border-radius:20px;font-size:12px;font-weight:bold;margin-top:10px;}
    footer{margin-top:28px;color:#D1D5DB;font-size:11px;}
    .footer-bar{background:#F8F9FA;padding:14px 32px;text-align:center;border-top:1px solid ${BORDER};}
    .footer-bar p{color:#ADB5BD;font-size:11px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="header-sub">PT. Cisarua Mountain Dairy</div>
      <div class="header-title">CODE Platform</div>
    </div>
    <div class="body">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      ${lines.map(l => `<p>${l}</p>`).join('')}
      ${badge ? `<div class="badge">${badge}</div>` : ''}
      <footer>CMD Plant Sentul &nbsp;&bull;&nbsp; Digital Transformation</footer>
    </div>
    <div class="footer-bar">
      <p>&copy; ${new Date().getFullYear()} CODE &mdash; Cimory Operational Digital Enhancement</p>
    </div>
  </div>
</body>
</html>`;
}

export function approvalSuccessPage(dashboardTitle, requesterName) {
  return responsePage({
    icon:       '✅',
    iconBg:     '#D1FAE5',
    title:      'Access Approved',
    titleColor: '#065F46',
    lines:      [`<strong>${requesterName}</strong> has been granted access to:`],
    badge:      dashboardTitle,
    badgeColor: '#065F46',
    badgeBg:    '#D1FAE5',
  });
}

export function rejectionSuccessPage(dashboardTitle, requesterName) {
  return responsePage({
    icon:       '❌',
    iconBg:     '#FEE2E2',
    title:      'Request Declined',
    titleColor: RED,
    lines:      [`Access to <strong>${dashboardTitle}</strong> has been declined for:`, `<strong>${requesterName}</strong>`],
    badge:      null,
    badgeColor: null,
    badgeBg:    null,
  });
}

export function approvalUserPage(nama, departemen) {
  return responsePage({
    icon:       '✅',
    iconBg:     '#D1FAE5',
    title:      'User Approved',
    titleColor: '#065F46',
    lines:      [`<strong>${nama}</strong> from <strong>${departemen}</strong>`, `has been approved and can now log in to CODE.`],
    badge:      'Registration Approved',
    badgeColor: '#065F46',
    badgeBg:    '#D1FAE5',
  });
}

export function rejectionUserPage(nama) {
  return responsePage({
    icon:       '❌',
    iconBg:     '#FEE2E2',
    title:      'Registration Declined',
    titleColor: RED,
    lines:      [`The registration for <strong>${nama}</strong> has been declined`, `and removed from the system.`],
    badge:      null,
    badgeColor: null,
    badgeBg:    null,
  });
}

export function alreadyProcessedPage(status) {
  const isApproved = status?.toUpperCase() === 'APPROVED';
  return responsePage({
    icon:       isApproved ? 'ℹ️' : 'ℹ️',
    iconBg:     '#E0F2FE',
    title:      'Already Processed',
    titleColor: BLUE,
    lines:      [`This request has already been <strong>${status?.toLowerCase() ?? 'processed'}</strong>.`, `No further action is required.`],
    badge:      null,
    badgeColor: null,
    badgeBg:    null,
  });
}

export function expiredLinkPage() {
  return responsePage({
    icon:       '⏰',
    iconBg:     '#FEF3C7',
    title:      'Link Expired',
    titleColor: '#92400E',
    lines:      ['This approval link has expired or is no longer valid.', 'Please log in to the CODE platform to manage this request.'],
    badge:      null,
    badgeColor: null,
    badgeBg:    null,
  });
}
