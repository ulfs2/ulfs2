const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// In Cloudflare Workers, resolving hostnames to raw IP addresses causes outbound TCP connections
// to fail with "proxy request failed, cannot connect to the specified address" (ESOCKET) because
// Cloudflare's outbound proxy requires connecting by domain hostname (e.g., smtp.gmail.com), not IP.
try {
  const nodemailerShared = require('nodemailer/lib/shared');
  if (nodemailerShared && typeof nodemailerShared.resolveHostname === 'function') {
    const originalResolve = nodemailerShared.resolveHostname;
    nodemailerShared.resolveHostname = function (options, callback) {
      if (options && options.host && typeof options.host === 'string') {
        const host = options.host.trim();
        const servername = options.servername || host;
        return callback(null, {
          host,
          servername,
          _addresses: [host],
          cached: false
        });
      }
      return originalResolve.apply(this, arguments);
    };
  }
} catch (patchErr) {
  console.warn('Could not patch nodemailer shared.resolveHostname:', patchErr.message);
}

let cryptoHelpers = null;
try {
  cryptoHelpers = require('./crypto');
} catch {}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate recipient email address to prevent bounces and SMTP restrictions
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(trimmed);
}

/**
 * Format academic section for display
 */
function formatSection(sec) {
  if (!sec) return 'MISPCE';
  return String(sec).trim().toUpperCase();
}

/**
 * Build the beautiful HTML email template
 */
function renderEmailTemplate({
  student = {},
  groupName = '',
  joinUrl = '',
  customMessage = '',
  senderName = 'ULFS2 Student Affairs & Delegation'
}) {
  const firstName = student.firstName || 'Student';
  const fatherName = student.fatherName || '';
  const familyName = student.familyName || '';
  const fullName = [firstName, fatherName, familyName].filter(Boolean).join(' ') || firstName;
  const major = student.major || 'Faculty of Sciences II';
  const section = formatSection(student.section || (student.major && /math|info|stat|phys|chem|elec/i.test(student.major) ? 'MISPCE' : 'CSVT'));
  const assignedGroup = student.assignedGroup || 'General Section';
  const campus = student.campus || 'Fanar / Amshit';
  const status = student.status || 'Student';
  const language = student.language || 'French / English';
  const targetGroupTitle = groupName || `ULFS2 ${major} (${section}) — ${assignedGroup}`;
  const effectiveJoinUrl = joinUrl || 'https://chat.whatsapp.com/';

  const subject = `Official Invitation: Join Your Class Group — ${targetGroupTitle}`;

  // Plain text fallback
  const text = `
Hello ${fullName},

You are officially invited to join your academic class group for ${major} (${section} - ${assignedGroup}) at Lebanese University, Faculty of Sciences II.

To join your group, please click the link below:
${effectiveJoinUrl}

--- Academic Track Details ---
• Student: ${fullName}
• Major: ${major}
• Academic Section: ${section}
• Assigned Group: ${assignedGroup}
• Campus: ${campus}
• Status: ${status}
• Language Track: ${language}

${customMessage ? `Note from your delegates:\n${customMessage}\n\n` : ''}Best regards,
${senderName}
Lebanese University — Faculty of Sciences II
`.trim();

  // Modern, high-conversion, responsive HTML template
  const html = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background-color: #f4efe9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #331f14;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f4efe9;
      padding: 40px 16px;
    }
    .main-card {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 20px;
      border: 1px solid #ebd9c8;
      overflow: hidden;
      box-shadow: 0 12px 36px rgba(124, 45, 18, 0.08);
    }
    .hero-header {
      background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
      padding: 36px 32px 30px;
      text-align: center;
      color: #ffffff;
    }
    .brand-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 30px;
      padding: 5px 16px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #ffffff;
      margin-bottom: 14px;
    }
    .hero-title {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.5px;
      color: #ffffff;
    }
    .hero-subtitle {
      margin: 0;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
    }
    .content-body {
      padding: 36px 32px;
      color: #431407;
    }
    .greeting {
      font-size: 18px;
      font-weight: 700;
      color: #431407;
      margin: 0 0 14px;
    }
    .welcome-text {
      font-size: 15px;
      line-height: 1.65;
      color: #5c3826;
      margin: 0 0 24px;
    }
    .academic-card {
      background: #faf5f0;
      border: 1px solid #eddcd0;
      border-radius: 14px;
      padding: 20px 22px;
      margin: 0 0 28px;
    }
    .academic-header {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #ea580c;
      margin-bottom: 14px;
      display: block;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
    }
    .info-table td {
      padding: 6px 0;
      font-size: 14px;
      vertical-align: top;
    }
    .info-label {
      width: 42%;
      color: #8c6a58;
      font-weight: 500;
    }
    .info-value {
      width: 58%;
      color: #431407;
      font-weight: 700;
      text-align: right;
    }
    .cta-container {
      text-align: center;
      margin: 32px 0 26px;
    }
    .cta-btn {
      display: inline-block;
      background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
      color: #ffffff !important;
      text-decoration: none !important;
      font-size: 16px;
      font-weight: 700;
      padding: 16px 36px;
      border-radius: 12px;
      box-shadow: 0 6px 18px rgba(234, 88, 12, 0.35);
      letter-spacing: 0.3px;
      transition: all 0.2s ease;
    }
    .cta-hint {
      display: block;
      font-size: 12px;
      color: #927565;
      margin-top: 10px;
    }
    .link-fallback {
      background: #fdfaf7;
      border: 1px dashed #e4cfbd;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 26px;
      font-size: 12px;
      color: #7c5c49;
      word-break: break-all;
    }
    .link-fallback a {
      color: #ea580c;
      font-weight: 600;
      text-decoration: underline;
    }
    .custom-note-box {
      background: #fff8f1;
      border-left: 4px solid #ea580c;
      border-radius: 0 10px 10px 0;
      padding: 14px 18px;
      margin-bottom: 24px;
      font-size: 14px;
      color: #63331b;
    }
    .custom-note-title {
      font-weight: 700;
      color: #c2410c;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .instructions-card {
      background: #ffffff;
      border: 1px solid #ebd9c8;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 24px;
    }
    .instructions-title {
      font-size: 13px;
      font-weight: 700;
      color: #431407;
      margin: 0 0 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .instructions-list {
      margin: 0;
      padding-left: 20px;
      font-size: 13px;
      color: #6d4b38;
      line-height: 1.6;
    }
    .instructions-list li {
      margin-bottom: 6px;
    }
    .footer {
      background-color: #faf5f0;
      border-top: 1px solid #ebd9c8;
      padding: 24px 32px;
      text-align: center;
      font-size: 12px;
      color: #8c6a58;
      line-height: 1.5;
    }
    .footer-logo {
      font-weight: 800;
      font-size: 13px;
      color: #431407;
      margin-bottom: 4px;
    }
    .footer-links a {
      color: #ea580c;
      text-decoration: none;
      margin: 0 6px;
      font-weight: 600;
    }
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 12px 6px !important; }
      .main-card { border-radius: 14px !important; }
      .hero-header { padding: 28px 20px !important; }
      .hero-title { font-size: 20px !important; }
      .content-body { padding: 24px 18px !important; }
      .academic-card { padding: 16px 14px !important; }
      .cta-btn { width: 100% !important; box-sizing: border-box !important; padding: 16px 20px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table role="presentation" class="main-card" align="center" width="100%" cellpadding="0" cellspacing="0">
      <!-- HEADER -->
      <tr>
        <td class="hero-header">
          <div class="brand-badge">Lebanese University • ULFS2</div>
          <h1 class="hero-title">Official Class Group Invitation</h1>
          <p class="hero-subtitle">${escapeHtml(targetGroupTitle)}</p>
        </td>
      </tr>

      <!-- BODY CONTENT -->
      <tr>
        <td class="content-body">
          <div class="greeting">Hello ${escapeHtml(fullName)},</div>
          <p class="welcome-text">
            Welcome to ULFS2! To make sure you never miss critical lecture schedules, classroom assignments, exam announcements, and course resources, please join your official student group.
          </p>

          <!-- ACADEMIC PROFILE SUMMARY -->
          <div class="academic-card">
            <span class="academic-header">Student Enrollment Track</span>
            <table role="presentation" class="info-table" cellpadding="0" cellspacing="0">
              <tr>
                <td class="info-label">Major</td>
                <td class="info-value">${escapeHtml(major)}</td>
              </tr>
              <tr>
                <td class="info-label">Academic Section</td>
                <td class="info-value">${escapeHtml(section)}</td>
              </tr>
              <tr>
                <td class="info-label">Assigned Group</td>
                <td class="info-value"><span style="color:#ea580c;">${escapeHtml(assignedGroup)}</span></td>
              </tr>
              <tr>
                <td class="info-label">Campus</td>
                <td class="info-value">${escapeHtml(campus)}</td>
              </tr>
              <tr>
                <td class="info-label">Language Track</td>
                <td class="info-value">${escapeHtml(language)}</td>
              </tr>
              <tr>
                <td class="info-label">Student Status</td>
                <td class="info-value">${escapeHtml(status)}</td>
              </tr>
            </table>
          </div>

          <!-- OPTIONAL CUSTOM NOTE -->
          ${customMessage ? `
          <div class="custom-note-box">
            <div class="custom-note-title">Note from Delegation</div>
            <div>${escapeHtml(customMessage)}</div>
          </div>
          ` : ''}

          <!-- PRIMARY CALL TO ACTION BUTTON -->
          <div class="cta-container">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(effectiveJoinUrl)}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="24%" stroke="f" fillcolor="#ea580c">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Join Class Group Now</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${escapeHtml(effectiveJoinUrl)}" target="_blank" rel="noopener noreferrer" class="cta-btn">
              📲 Join Class Group Now
            </a>
            <!--<![endif]-->
            <span class="cta-hint">Direct link to WhatsApp / Community Group</span>
          </div>

          <!-- FALLBACK DIRECT LINK -->
          <div class="link-fallback">
            <strong>Having trouble with the button?</strong> Copy and paste this link into your browser:<br>
            <a href="${escapeHtml(effectiveJoinUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(effectiveJoinUrl)}</a>
          </div>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td class="footer">
          <div class="footer-logo">Faculty of Sciences II — Fanar &amp; Amshit</div>
          ${senderName ? `<div style="margin-top:6px;font-size:12px;color:#9a3412;">${escapeHtml(senderName)}</div>` : ''}
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * Configure or obtain the nodemailer transporter
 */
let cachedTransporter = null;
let etherealAccount = null;

function isCloudflareRuntime() {
  return process.env.CLOUDFLARE_WORKER === 'true'
    || Boolean(process.env.CLOUDFLARE || process.env.CF_PAGES);
}

async function sendMailWithTimeout(transporter, mailOptions, timeoutMs = 18000) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      try {
        if (transporter && typeof transporter.close === 'function') transporter.close();
      } catch {}
      const error = new Error(`SMTP server did not respond within ${Math.ceil(timeoutMs / 1000)} seconds`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([transporter.sendMail(mailOptions), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

const baseDirectory = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : null);

const CONFIG_FILE = baseDirectory ? path.join(baseDirectory, 'email_settings.json') : null;
const LOGS_FILE = baseDirectory ? path.join(baseDirectory, 'email_logs.json') : null;
let inMemorySettings = null;
let inMemoryLogs = null;

function loadEmailLogs() {
  if (inMemoryLogs) return inMemoryLogs;
  inMemoryLogs = [];
  if (process.env.NODE_ENV === 'test') return inMemoryLogs;
  try {
    if (LOGS_FILE && fs && typeof fs.existsSync === 'function' && fs.existsSync(LOGS_FILE)) {
      const raw = fs.readFileSync(LOGS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        inMemoryLogs = data;
      }
    }
  } catch (err) {
    console.warn('Could not read email_logs.json:', err.message);
  }
  return inMemoryLogs;
}

function saveEmailLogsToDisk() {
  if (process.env.NODE_ENV === 'test') return;
  if (!LOGS_FILE || !fs || typeof fs.writeFileSync !== 'function') return;
  try {
    const logsToSave = (inMemoryLogs || []).slice(0, 1000);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logsToSave, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not write email_logs.json:', err.message);
  }
}

function recordEmailLog(entry) {
  loadEmailLogs();
  const logItem = {
    id: entry.id || `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    studentId: entry.studentId || null,
    studentName: entry.studentName || 'Student',
    email: entry.email || '',
    major: entry.major || '',
    section: entry.section || '',
    assignedGroup: entry.assignedGroup || '',
    campus: entry.campus || '',
    groupKey: entry.groupKey || '',
    joinUrl: entry.joinUrl || '',
    status: entry.status || 'sent',
    messageId: entry.messageId || null,
    previewUrl: entry.previewUrl || null,
    error: entry.error || null,
    isSimulated: Boolean(entry.isSimulated),
    isRateLimit: Boolean(entry.isRateLimit),
    broadcastId: entry.broadcastId || null
  };

  inMemoryLogs.unshift(logItem);
  if (inMemoryLogs.length > 2000) {
    inMemoryLogs = inMemoryLogs.slice(0, 2000);
  }
  saveEmailLogsToDisk();
  return logItem;
}

function getEmailLogs({ limit = 200, offset = 0, status, search, broadcastId } = {}) {
  loadEmailLogs();
  let list = inMemoryLogs || [];

  if (status && status !== 'all') {
    list = list.filter(item => item.status === status);
  }

  if (broadcastId) {
    list = list.filter(item => item.broadcastId === broadcastId);
  }

  if (search) {
    const q = String(search).trim().toLowerCase();
    list = list.filter(item =>
      (item.studentName && item.studentName.toLowerCase().includes(q)) ||
      (item.email && item.email.toLowerCase().includes(q)) ||
      (item.major && item.major.toLowerCase().includes(q)) ||
      (item.assignedGroup && item.assignedGroup.toLowerCase().includes(q)) ||
      (item.groupKey && item.groupKey.toLowerCase().includes(q)) ||
      (item.error && item.error.toLowerCase().includes(q))
    );
  }

  const total = list.length;
  const paginated = list.slice(offset, offset + limit);

  const allLogs = inMemoryLogs || [];
  const totalSent = allLogs.filter(l => l.status === 'sent').length;
  const totalFailed = allLogs.filter(l => l.status === 'failed').length;
  const totalSkipped = allLogs.filter(l => l.status === 'skipped').length;
  const lastBroadcast = allLogs[0]?.timestamp || null;

  return {
    logs: paginated,
    total,
    stats: {
      totalSent,
      totalFailed,
      totalSkipped,
      totalLogged: allLogs.length,
      lastBroadcastAt: lastBroadcast
    }
  };
}

function clearEmailLogs() {
  inMemoryLogs = [];
  saveEmailLogsToDisk();
  return { success: true };
}

function getEmailLogStats() {
  loadEmailLogs();
  const allLogs = inMemoryLogs || [];
  const totalSent = allLogs.filter(l => l.status === 'sent').length;
  const totalFailed = allLogs.filter(l => l.status === 'failed').length;
  const totalSkipped = allLogs.filter(l => l.status === 'skipped').length;
  const total = allLogs.length;
  const successRate = total > 0 ? Math.round((totalSent / total) * 100) : 0;
  return {
    total,
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
    successRate
  };
}

const addEmailLog = recordEmailLog;

let dbModule = null;
function getSupabaseClient() {
  if (dbModule === null) {
    try {
      dbModule = require('./db');
    } catch {
      dbModule = false;
    }
  }
  return dbModule && dbModule.supabase ? dbModule.supabase : null;
}

function loadSavedSettings() {
  if (inMemorySettings) return inMemorySettings;
  try {
    if (CONFIG_FILE && fs && typeof fs.existsSync === 'function' && fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        let pass = data.smtpPass || '';
        if (pass && cryptoHelpers && typeof cryptoHelpers.decryptValue === 'function') {
          try {
            pass = cryptoHelpers.decryptValue(pass, 'email_settings.smtp_pass');
          } catch {}
        }
        inMemorySettings = { ...data, smtpPass: pass };
        return inMemorySettings;
      }
    }
  } catch (err) {
    console.warn('Could not read email_settings.json:', err.message);
  }
  return inMemorySettings;
}

async function syncEmailSettingsFromDb() {
  const supabase = getSupabaseClient();
  if (!supabase) return inMemorySettings;
  try {
    const { data, error } = await supabase
      .from('students')
      .select('note')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle();

    if (!error && data && data.note && cryptoHelpers && typeof cryptoHelpers.decryptValue === 'function') {
      const decrypted = cryptoHelpers.decryptValue(data.note, 'system.email_settings');
      const parsed = JSON.parse(decrypted);
      if (parsed && typeof parsed === 'object') {
        let pass = parsed.smtpPass || '';
        if (pass.startsWith('enc:v1:')) {
          try {
            pass = cryptoHelpers.decryptValue(pass, 'email_settings.smtp_pass');
          } catch {}
        }
        inMemorySettings = { ...(inMemorySettings || {}), ...parsed, smtpPass: pass };
      }
    }
  } catch (err) {
    // Ignore network / schema errors
  }
  return inMemorySettings;
}

function getSmtpConfig() {
  const saved = loadSavedSettings() || {};
  const host = saved.smtpHost !== undefined ? saved.smtpHost : (process.env.SMTP_HOST || '');
  const port = saved.smtpPort ? parseInt(saved.smtpPort, 10) : parseInt(process.env.SMTP_PORT || '465', 10);
  const user = saved.smtpUser !== undefined ? saved.smtpUser : (process.env.SMTP_USER || process.env.SMTP_USERNAME || '');
  const pass = saved.smtpPass !== undefined ? saved.smtpPass : (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '');
  const isPort465 = port === 465;
  const secure = isPort465 ? true : (saved.smtpSecure !== undefined ? Boolean(saved.smtpSecure) : (process.env.SMTP_SECURE === 'true'));
  const from = saved.emailFrom || process.env.EMAIL_FROM || process.env.SMTP_FROM || 'ULFS2 Student Affairs <noreply@student-os.com>';

  const isConfigured = Boolean(host && user);
  return { host, port, user, pass, secure, from, isConfigured };
}

async function saveEmailSettings(settings) {
  const current = loadSavedSettings() || {};
  let passwordToStore = settings.smtpPass !== undefined && settings.smtpPass !== ''
    ? settings.smtpPass
    : (current.smtpPass || process.env.SMTP_PASS || '');

  // Update process.env runtime
  if (settings.smtpHost !== undefined) process.env.SMTP_HOST = settings.smtpHost;
  if (settings.smtpPort !== undefined) process.env.SMTP_PORT = String(settings.smtpPort);
  if (settings.smtpSecure !== undefined) process.env.SMTP_SECURE = String(Boolean(settings.smtpSecure));
  if (settings.smtpUser !== undefined) process.env.SMTP_USER = settings.smtpUser;
  if (passwordToStore) process.env.SMTP_PASS = passwordToStore;
  if (settings.emailFrom !== undefined) process.env.EMAIL_FROM = settings.emailFrom;

  // Invalidate transporter cache
  cachedTransporter = null;

  // Encrypt password if possible
  let storedPass = passwordToStore;
  if (storedPass && cryptoHelpers && typeof cryptoHelpers.encryptValue === 'function') {
    try {
      storedPass = cryptoHelpers.encryptValue(storedPass, 'email_settings.smtp_pass');
    } catch {}
  }

  const payload = {
    smtpHost: settings.smtpHost !== undefined ? settings.smtpHost : (current.smtpHost || process.env.SMTP_HOST || ''),
    smtpPort: settings.smtpPort !== undefined ? Number(settings.smtpPort) : (current.smtpPort || Number(process.env.SMTP_PORT || '465')),
    smtpSecure: settings.smtpSecure !== undefined ? Boolean(settings.smtpSecure) : (current.smtpSecure !== undefined ? current.smtpSecure : (process.env.SMTP_SECURE === 'true')),
    smtpUser: settings.smtpUser !== undefined ? settings.smtpUser : (current.smtpUser || process.env.SMTP_USER || ''),
    smtpPass: storedPass || '',
    emailFrom: settings.emailFrom !== undefined ? settings.emailFrom : (current.emailFrom || process.env.EMAIL_FROM || 'ULFS2 Student Affairs <noreply@student-os.com>'),
    groupLinks: settings.groupLinks !== undefined ? settings.groupLinks : (current.groupLinks || {
      general: '',
      'Grp A': '',
      'Grp B': '',
      'Grp C,D': '',
      'Grp E1': '',
      'Grp E2': '',
      'Amchit': ''
    }),
    defaultCustomNote: settings.defaultCustomNote !== undefined ? settings.defaultCustomNote : (current.defaultCustomNote || '')
  };

  inMemorySettings = { ...payload, smtpPass: passwordToStore };

  if (CONFIG_FILE && fs && typeof fs.writeFileSync === 'function') {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('Could not write email_settings.json:', err.message);
    }
  }

  // Also sync to .env file if it exists (not in test mode)
  const envPath = baseDirectory ? path.join(baseDirectory, '.env') : null;
  if (envPath && process.env.NODE_ENV !== 'test' && fs && typeof fs.existsSync === 'function' && fs.existsSync(envPath)) {
    try {
      let content = fs.readFileSync(envPath, 'utf8');
      const envUpdates = {
        SMTP_HOST: payload.smtpHost,
        SMTP_PORT: payload.smtpPort,
        SMTP_SECURE: payload.smtpSecure,
        SMTP_USER: payload.smtpUser,
        SMTP_PASS: passwordToStore || '',
        EMAIL_FROM: payload.emailFrom
      };
      for (const [key, val] of Object.entries(envUpdates)) {
        if (val === undefined || val === null) continue;
        const regex = new RegExp(`^${key}=.*$`, 'm');
        const formatted = String(val).includes(' ') ? `"${val}"` : val;
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${formatted}`);
        } else {
          content = `${content.trim()}\n${key}=${formatted}\n`;
        }
      }
      fs.writeFileSync(envPath, content, 'utf8');
    } catch (e) {
      console.warn('Could not sync .env:', e.message);
    }
  }

  // Persist to Supabase if available so settings survive Worker isolate recycling
  const supabase = getSupabaseClient();
  if (supabase && process.env.NODE_ENV !== 'test' && cryptoHelpers && typeof cryptoHelpers.encryptValue === 'function') {
    try {
      const encryptedConfig = cryptoHelpers.encryptValue(JSON.stringify(payload), 'system.email_settings');
      await supabase.from('students').upsert({
        id: '00000000-0000-0000-0000-000000000001',
        first_name: '__SYSTEM_CONFIG__',
        father_name: 'CONFIG',
        family_name: 'EMAIL_SETTINGS',
        school: 'SYSTEM',
        major: 'SYSTEM',
        status: 'SYSTEM',
        language: 'SYSTEM',
        campus: 'SYSTEM',
        phone: 'SYSTEM',
        email: 'system@student-os.local',
        note: encryptedConfig
      }, { onConflict: 'id' });
    } catch (supaErr) {
      console.warn('Could not persist email settings to Supabase:', supaErr.message);
    }
  }

  return getEffectiveSettings();
}

function getEffectiveSettings() {
  const saved = loadSavedSettings() || {};
  const host = saved.smtpHost !== undefined ? saved.smtpHost : (process.env.SMTP_HOST || '');
  const port = saved.smtpPort ? parseInt(saved.smtpPort, 10) : parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = saved.smtpSecure !== undefined ? saved.smtpSecure : (process.env.SMTP_SECURE === 'true' || port === 465);
  const user = saved.smtpUser !== undefined ? saved.smtpUser : (process.env.SMTP_USER || process.env.SMTP_USERNAME || '');
  const pass = saved.smtpPass !== undefined ? saved.smtpPass : (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '');
  const from = saved.emailFrom || process.env.EMAIL_FROM || 'ULFS2 Student Affairs <noreply@student-os.com>';

  const groupLinks = saved.groupLinks || {
    general: '',
    'Grp A': '',
    'Grp B': '',
    'Grp C,D': '',
    'Grp E1': '',
    'Grp E2': '',
    'Amchit': ''
  };

  const defaultCustomNote = saved.defaultCustomNote || '';

  return {
    smtpHost: host,
    smtpPort: port,
    smtpSecure: secure,
    smtpUser: user,
    smtpPass: '', // never return raw password to client
    smtpPassSet: Boolean(pass),
    emailFrom: from,
    configured: Boolean(host && user),
    groupLinks,
    defaultCustomNote
  };
}

async function getTransporter(overrideConfig = null) {
  const baseConfig = getSmtpConfig();
  const config = overrideConfig ? {
    host: overrideConfig.host || baseConfig.host,
    port: overrideConfig.port ? parseInt(overrideConfig.port, 10) : baseConfig.port,
    user: overrideConfig.user || baseConfig.user,
    pass: overrideConfig.pass || baseConfig.pass,
    secure: (overrideConfig.secure !== undefined ? Boolean(overrideConfig.secure) : (overrideConfig.port === 465 || baseConfig.secure)),
    from: overrideConfig.from || baseConfig.from,
    isConfigured: Boolean((overrideConfig.host || baseConfig.host) && (overrideConfig.user || baseConfig.user))
  } : baseConfig;

  // Hermetic mock transporter for automated test runner
  if (process.env.NODE_ENV === 'test') {
    const mockTransporter = {
      sendMail: async (mailOptions) => ({
        messageId: `test-${Date.now()}@student-os.local`,
        response: '250 Mock email accepted',
        envelope: { from: mailOptions.from, to: [mailOptions.to] }
      }),
      _isMock: true
    };
    return { transporter: mockTransporter, config, isReal: false, isMock: true };
  }

  if (config.isConfigured) {
    const portNum = Number(config.port) || 465;
    const isDirectTls = portNum === 465 || Boolean(config.secure);

    let cleanPass = config.pass || '';
    if ((config.host.includes('gmail') || config.host.includes('google')) && cleanPass) {
      cleanPass = cleanPass.replace(/\s+/g, '');
    }

    const isCloudflare = isCloudflareRuntime();
    const transportOpts = {
      pool: !isCloudflare,
      maxConnections: 1,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 1,
      host: config.host,
      port: portNum,
      secure: isDirectTls,
      auth: {
        user: config.user.trim(),
        pass: cleanPass
      },
      connectionTimeout: isCloudflare ? 10000 : 15000,
      greetingTimeout: isCloudflare ? 10000 : 15000,
      socketTimeout: isCloudflare ? 15000 : 20000,
      dnsTimeout: 5000
    };

    if (overrideConfig) {
      const customTransporter = nodemailer.createTransport(transportOpts);
      return { transporter: customTransporter, config, isReal: true };
    }

    if (!cachedTransporter || cachedTransporter._configHost !== config.host || cachedTransporter._configUser !== config.user || cachedTransporter._configPort !== portNum || cachedTransporter._configSecure !== isDirectTls) {
      cachedTransporter = nodemailer.createTransport(transportOpts);
      cachedTransporter._configHost = config.host;
      cachedTransporter._configUser = config.user;
      cachedTransporter._configPort = portNum;
      cachedTransporter._configSecure = isDirectTls;
      cachedTransporter._isRealSmtp = true;
    }
    return { transporter: cachedTransporter, config, isReal: true };
  }

  try {
    if (!etherealAccount) {
      etherealAccount = await nodemailer.createTestAccount();
    }
    const testTransporter = nodemailer.createTransport({
      host: etherealAccount.smtp.host,
      port: etherealAccount.smtp.port,
      secure: etherealAccount.smtp.secure,
      auth: {
        user: etherealAccount.user,
        pass: etherealAccount.pass
      }
    });
    return { transporter: testTransporter, config, isReal: false, isEthereal: true, etherealAccount };
  } catch (err) {
    // If network fails to reach Ethereal, use a graceful simulated sender
    const simulatedTransporter = {
      sendMail: async (mailOptions) => ({
        messageId: `simulated-${Date.now()}@student-os.local`,
        response: '250 Simulated local delivery (SMTP not configured in .env)',
        envelope: { from: mailOptions.from, to: [mailOptions.to] }
      }),
      _isSimulated: true
    };
    return { transporter: simulatedTransporter, config, isReal: false, isSimulated: true };
  }
}

function isSmtpRateLimitError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const response = String(err.response || '').toLowerCase();
  const code = String(err.code || err.responseCode || '');
  return (
    code === '421' ||
    code === '450' ||
    code === '451' ||
    code === '452' ||
    (code === '550' && (msg.includes('quota') || msg.includes('limit') || response.includes('quota'))) ||
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('quota exceeded') ||
    msg.includes('user sending quota') ||
    msg.includes('burst') ||
    msg.includes('throttl') ||
    msg.includes('try again later') ||
    msg.includes('temporary failure') ||
    response.includes('rate limit') ||
    response.includes('too many') ||
    response.includes('quota exceeded')
  );
}

/**
 * Send an invitation email to a single student
 */
async function sendInviteEmail({
  to,
  student,
  groupName,
  joinUrl,
  customMessage,
  senderName
}) {
  if (!to) {
    throw new Error('Recipient email address is required');
  }

  const { subject, html, text } = renderEmailTemplate({
    student,
    groupName,
    joinUrl,
    customMessage,
    senderName
  });

  const { transporter, config, isReal, isEthereal, isSimulated, isMock } = await getTransporter();

  const recipientEmail = String(to).trim();
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    throw new Error(`Invalid recipient email address: "${to}"`);
  }

  const senderDomain = (config.from.match(/@([a-zA-Z0-9.-]+)/) || [])[1] || 'student-os.com';
  const cleanId = student?.id ? String(student.id).replace(/[^a-zA-Z0-9_-]/g, '') : Date.now();
  const messageId = `<invite-${cleanId}-${Date.now()}@${senderDomain}>`;

  const mailOptions = {
    from: config.from,
    to: recipientEmail,
    subject,
    text,
    html,
    messageId,
    date: new Date(),
    headers: {
      'X-Mailer': 'StudentOS-Mailer/2.4 (ULFS2 Academic Platform)',
      'Precedence': 'bulk',
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All, OOF, AutoReply',
      'List-Unsubscribe': `<mailto:${config.user || 'noreply@student-os.com'}?subject=unsubscribe>`,
      'List-Id': `"ULFS2 Class Communications" <notifications.${senderDomain}>`
    }
  };

  let info;
  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      info = await sendMailWithTimeout(transporter, mailOptions, isCloudflareRuntime() ? 18000 : 24000);
      break;
    } catch (err) {
      const isRateLimit = isSmtpRateLimitError(err);
      if (isRateLimit) {
        err.isRateLimit = true;
        err.friendlyMessage = 'Your email provider has temporarily throttled sending. Safe pacing is recommended to avoid restriction.';
        if (attempts < 2 && process.env.NODE_ENV !== 'test' && !isCloudflareRuntime()) {
          console.warn(`[emailService] SMTP rate limit response detected: "${err.message}". Backing off 3000ms before retry 1/1...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
      }
      recordEmailLog({
        studentId: student?.id || null,
        studentName: [student?.firstName, student?.familyName].filter(Boolean).join(' ') || 'Student',
        email: recipientEmail,
        major: student?.major || '',
        section: student?.section || '',
        assignedGroup: student?.assignedGroup || '',
        campus: student?.campus || '',
        groupKey: groupName || student?.assignedGroup || 'General',
        joinUrl,
        status: 'failed',
        error: err.message,
        isRateLimit,
        isSimulated: Boolean(isSimulated || isMock),
        timestamp: new Date().toISOString()
      });
      throw err;
    }
  }

  let previewUrl = null;
  if (isEthereal && nodemailer.getTestMessageUrl) {
    previewUrl = nodemailer.getTestMessageUrl(info);
  }

  recordEmailLog({
    studentId: student?.id || null,
    studentName: [student?.firstName, student?.familyName].filter(Boolean).join(' ') || 'Student',
    email: recipientEmail,
    major: student?.major || '',
    section: student?.section || '',
    assignedGroup: student?.assignedGroup || '',
    campus: student?.campus || '',
    groupKey: groupName || student?.assignedGroup || 'General',
    joinUrl,
    status: 'sent',
    messageId: info?.messageId || messageId,
    previewUrl,
    isSimulated: Boolean(isSimulated || isMock),
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    messageId: info?.messageId || messageId,
    recipient: recipientEmail,
    subject,
    previewUrl,
    isRealSmtp: Boolean(isReal),
    isSimulated: Boolean(isSimulated || isMock),
    note: isReal ? 'Sent via configured SMTP' : (previewUrl ? `Sent to Ethereal test inbox: ${previewUrl}` : 'Simulated (configure SMTP in .env for production delivery)')
  };
}

/**
 * Send a test email to verify SMTP configuration
 */
async function sendTestEmail({ to, senderName = 'ULFS2 Administrator', overrideConfig = null }) {
  if (!to || !to.includes('@')) {
    throw new Error('Please enter a valid recipient email address for testing.');
  }

  const sampleStudent = {
    firstName: 'Test',
    fatherName: 'Delivery',
    familyName: 'Recipient',
    major: 'Informatics',
    section: 'mispce',
    assignedGroup: 'Grp A',
    campus: 'Fanar',
    language: 'French',
    status: 'New',
    email: to
  };

  const { subject, html, text } = renderEmailTemplate({
    student: sampleStudent,
    groupName: 'ULFS2 Test Class Group',
    joinUrl: 'https://chat.whatsapp.com/TEST_CONNECTION',
    customMessage: 'This is an official verification email confirming that your SMTP server settings are correctly configured on student-os.com.',
    senderName
  });

  const { transporter, config, isReal, isEthereal, isSimulated, isMock } = await getTransporter(overrideConfig);

  const mailOptions = {
    from: config.from,
    to,
    subject: `[TEST] ${subject}`,
    text,
    html
  };

  const info = await sendMailWithTimeout(transporter, mailOptions, isCloudflareRuntime() ? 18000 : 24000);
  let previewUrl = null;
  if (isEthereal && nodemailer.getTestMessageUrl) {
    previewUrl = nodemailer.getTestMessageUrl(info);
  }

  return {
    success: true,
    messageId: info.messageId,
    recipient: to,
    previewUrl,
    isRealSmtp: Boolean(isReal),
    isSimulated: Boolean(isSimulated || isMock),
    note: isReal ? 'Test email dispatched successfully via configured SMTP server.' : 'Test email processed in test mode.'
  };
}

/**
 * Public status check for the email subsystem
 */
function getMailerStatus() {
  const config = getSmtpConfig();
  return {
    configured: config.isConfigured,
    host: config.host || null,
    port: config.port,
    secure: config.secure,
    from: config.from,
    testMode: !config.isConfigured
  };
}

module.exports = {
  renderEmailTemplate,
  sendInviteEmail,
  sendTestEmail,
  getMailerStatus,
  getSmtpConfig,
  saveEmailSettings,
  getEffectiveSettings,
  syncEmailSettingsFromDb,
  escapeHtml,
  isValidEmail,
  isSmtpRateLimitError,
  recordEmailLog,
  addEmailLog,
  getEmailLogs,
  clearEmailLogs,
  loadEmailLogs,
  getEmailLogStats
};
