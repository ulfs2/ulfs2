const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { encryptValue, decryptValue, hashPassword, verifyPassword, signSession, verifySession } = require('./crypto');

const { pool, supabase, supabaseRequested, initDb, checkDbConnection } = require('./db');
const { getSettings, runGoogleDriveBackup, exchangeGoogleCode, googleAuthorizationUrl } = require('./backup');
const {
  renderEmailTemplate,
  sendInviteEmail,
  getMailerStatus,
  saveEmailSettings,
  getEffectiveSettings,
  sendTestEmail,
  syncEmailSettingsFromDb,
  recordEmailLog,
  getEmailLogs,
  clearEmailLogs,
  isSmtpRateLimitError,
  isValidEmail
} = require('./emailService');

const app = express();
const PORT = process.env.PORT || 3000;

const VALID_SECTIONS = ['mispce', 'csvt', 'all'];
const MISPCE_MAJORS = ['mathematics', 'informatics', 'statistics', 'physics', 'chemistry', 'electronics'];
const CSVT_MAJORS = ['biology', 'biochemistry', 'chemistry'];

function inferSectionFromMajor(major = '') {
  const norm = String(major || '').trim().toLowerCase();
  if (['biology', 'bio', 'biologie', 'biochemistry', 'biochimie', 'ciochimie'].includes(norm)) {
    return 'csvt';
  }
  return 'mispce';
}

function parseUserFullNamePayload(value) {
  if (!value) return { fullName: '', section: 'mispce' };
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
      return {
        fullName: parsed.name,
        section: (parsed.section || 'mispce').toLowerCase()
      };
    }
  } catch {}
  return { fullName: value, section: 'mispce' };
}

function buildUserFullNamePayload(fullName = '', section = 'mispce') {
  return JSON.stringify({
    name: String(fullName || '').trim(),
    section: (section || 'mispce').toLowerCase()
  });
}

function parseStudentNotePayload(value) {
  if (!value) return { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
  try {
    const decrypted = decryptValue(value, 'students.note');
    if (!decrypted) return { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
    const parsed = JSON.parse(decrypted);
    const approved = Boolean(parsed.linkApproved !== undefined ? parsed.linkApproved : parsed.inClass);
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      assignedGroup: typeof parsed.assignedGroup === 'string' ? parsed.assignedGroup : '',
      section: typeof parsed.section === 'string' ? parsed.section.toLowerCase() : '',
      linkApproved: approved,
      inClass: approved,
      emailSent: Boolean(parsed.emailSent)
    };
  } catch {
    return { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
  }
}

function buildStudentNotePayload(text = '', assignedGroup = '', section = '', linkApproved = false, emailSent = false) {
  const approved = Boolean(linkApproved);
  return JSON.stringify({
    text: text || '',
    assignedGroup: assignedGroup || '',
    section: section || '',
    linkApproved: approved,
    inClass: approved,
    emailSent: Boolean(emailSent)
  });
}

function readStudentNote(value) {
  return parseStudentNotePayload(value).text;
}

const mapStudent = row => {
  const notePayload = parseStudentNotePayload(row.note);
  const assignedGroup = row.assigned_group
    ? decryptValue(row.assigned_group, 'students.assigned_group')
    : (row.assignedGroup || notePayload.assignedGroup || '');
  const major = decryptValue(row.major, 'students.major');
  const section = (row.section ? decryptValue(row.section, 'students.section') : (notePayload.section || inferSectionFromMajor(major))).toLowerCase();
  const linkApproved = Boolean(
    row.link_approved !== undefined ? row.link_approved :
    row.linkApproved !== undefined ? row.linkApproved :
    row.in_class !== undefined ? row.in_class :
    row.inClass !== undefined ? row.inClass :
    notePayload.linkApproved !== undefined ? notePayload.linkApproved :
    notePayload.inClass
  );
  const emailSent = Boolean(
    row.email_sent !== undefined ? row.email_sent :
    row.emailSent !== undefined ? row.emailSent :
    notePayload.emailSent
  );

  return {
    id: row.id,
    note: notePayload.text,
    kazaa: row.kazaa ? decryptValue(row.kazaa, 'students.kazaa') : '',
    firstName: decryptValue(row.first_name, 'students.first_name'),
    fatherName: decryptValue(row.father_name, 'students.father_name'),
    familyName: decryptValue(row.family_name, 'students.family_name'),
    origin: decryptValue(row.origin, 'students.origin'),
    address: decryptValue(row.address, 'students.address'),
    school: decryptValue(row.school, 'students.school'),
    major,
    section,
    politicalAffiliation: decryptValue(row.political_affiliation, 'students.political_affiliation'),
    status: decryptValue(row.status, 'students.status'),
    language: decryptValue(row.language, 'students.language'),
    campus: decryptValue(row.campus, 'students.campus'),
    phone: decryptValue(row.phone, 'students.phone'),
    email: decryptValue(row.email, 'students.email'),
    inGroup: Boolean(row.in_group !== undefined ? row.in_group : row.inGroup),
    leftGroup: Boolean(row.left_group !== undefined ? row.left_group : row.leftGroup),
    assignedGroup: assignedGroup || '',
    linkApproved,
    inClass: linkApproved,
    emailSent,
    createdAt: row.created_at
  };
};

const isSystemStudent = row => {
  if (!row) return false;
  const idStr = String(row.id || '');
  const fnStr = String(row.first_name || row.firstName || '');
  return idStr === '00000000-0000-0000-0000-000000000001' || fnStr.startsWith('__SYSTEM');
};

const toStudentRow = student => {
  const targetSection = student.section || inferSectionFromMajor(student.major);
  const isApproved = student.linkApproved !== undefined ? Boolean(student.linkApproved) : Boolean(student.inClass);
  const isEmailSent = Boolean(student.emailSent !== undefined ? student.emailSent : student.email_sent);
  const notePayload = buildStudentNotePayload(
    student.note || '',
    student.assignedGroup || '',
    targetSection,
    isApproved,
    isEmailSent
  );

  const row = {
    first_name: encryptValue(student.firstName, 'students.first_name'),
    father_name: encryptValue(student.fatherName, 'students.father_name'),
    family_name: encryptValue(student.familyName, 'students.family_name'),
    origin: encryptValue(student.origin || '', 'students.origin'),
    address: encryptValue(student.address || '', 'students.address'),
    school: encryptValue(student.school, 'students.school'),
    major: encryptValue(student.major, 'students.major'),
    political_affiliation: encryptValue(student.politicalAffiliation || '', 'students.political_affiliation'),
    status: encryptValue(student.status, 'students.status'),
    language: encryptValue(student.language, 'students.language'),
    campus: encryptValue(student.campus, 'students.campus'),
    phone: encryptValue(student.phone, 'students.phone'),
    email: encryptValue(student.email, 'students.email'),
    note: encryptValue(notePayload, 'students.note')
  };
  if (student.kazaa !== undefined) {
    row.kazaa = student.kazaa ? encryptValue(student.kazaa, 'students.kazaa') : '';
  }
  if (student.emailSent !== undefined || student.email_sent !== undefined) {
    row.email_sent = isEmailSent;
  }
  return row;
};

const normalizeText = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const normalizePhone = value => String(value || '').replace(/\D/g, '');

const studentIdentity = student => ({
  name: [student.firstName, student.fatherName, student.familyName].map(normalizeText).join('|'),
  email: normalizeText(student.email),
  phone: normalizePhone(student.phone)
});

const duplicateReason = (candidate, existingStudents) => {
  const identity = studentIdentity(candidate);
  for (const student of existingStudents) {
    const existing = studentIdentity(student);
    if (identity.email && identity.email === existing.email) return 'email address';
    if (identity.phone && identity.phone === existing.phone) return 'phone number';
    if (identity.name && identity.name === existing.name) return 'full name';
  }
  return null;
};

async function findDuplicateStudent(candidate, excludedId = null) {
  let students;
  if (supabase) {
    const { data, error } = await supabase
      .from('students')
      .select('id, first_name, father_name, family_name, phone, email');
    if (error) throw error;
    students = (data || []).filter(r => !isSystemStudent(r)).map(mapStudent);
  } else {
    const { rows } = await pool.query(
      'SELECT id, first_name, father_name, family_name, phone, email FROM students'
    );
    students = rows.map(row => ({
      id: row.id,
      firstName: decryptValue(row.first_name, 'students.first_name'),
      fatherName: decryptValue(row.father_name, 'students.father_name'),
      familyName: decryptValue(row.family_name, 'students.family_name'),
      phone: decryptValue(row.phone, 'students.phone'),
      email: decryptValue(row.email, 'students.email')
    }));
  }

  return duplicateReason(
    candidate,
    students.filter(student => String(student.id) !== String(excludedId))
  );
}

async function findStudentById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('students').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapStudent(data);
  } else {
    const { rows } = await pool.query(`
      SELECT 
        note,
        kazaa,
        id, 
        first_name AS "firstName", 
        father_name AS "fatherName", 
        family_name AS "familyName", 
        origin, 
        address, 
        school, 
        major, 
        political_affiliation AS "politicalAffiliation",
        status, 
        language, 
        campus, 
        phone, 
        email, 
        in_group AS "inGroup",
        left_group AS "leftGroup",
        created_at AS "createdAt"
      FROM students 
      WHERE id = $1;
    `, [id]);
    if (rows.length === 0) return null;
    return mapStudent(rows[0]);
  }
}

async function setStudentApprovalState(id, linkApproved) {
  if (supabase) {
    let updateResult = await supabase
      .from('students')
      .update({ in_class: linkApproved })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateResult.error && (updateResult.error.code === 'PGRST204' || updateResult.error.code === '42703' || /in_class/i.test(updateResult.error.message))) {
      const { data: studentRecord } = await supabase.from('students').select('note').eq('id', id).maybeSingle();
      const currentPayload = studentRecord ? parseStudentNotePayload(studentRecord.note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: currentPayload.text,
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved,
        inClass: linkApproved,
        emailSent: Boolean(currentPayload.emailSent)
      };
      const encryptedNote = encryptValue(JSON.stringify(newPayload), 'students.note');

      updateResult = await supabase
        .from('students')
        .update({ note: encryptedNote })
        .eq('id', id)
        .select()
        .maybeSingle();
    }

    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) return null;
    return mapStudent(updateResult.data);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE students SET in_class = $1 WHERE id = $2 RETURNING *;`,
      [linkApproved, id]
    );
    if (!rows.length) return null;
    return mapStudent(rows[0]);
  } catch (pgErr) {
    if (pgErr.code === '42703' || /in_class/i.test(pgErr.message)) {
      const noteRes = await pool.query('SELECT note FROM students WHERE id = $1', [id]);
      const currentPayload = noteRes.rows[0] ? parseStudentNotePayload(noteRes.rows[0].note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: currentPayload.text,
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved,
        inClass: linkApproved,
        emailSent: Boolean(currentPayload.emailSent)
      };
      const encryptedNote = encryptValue(JSON.stringify(newPayload), 'students.note');

      const { rows } = await pool.query(
        `UPDATE students SET note = $1 WHERE id = $2 RETURNING *;`,
        [encryptedNote, id]
      );
      if (!rows.length) return null;
      return mapStudent(rows[0]);
    }
    throw pgErr;
  }
}

async function setStudentEmailSentState(id, emailSent) {
  const sent = Boolean(emailSent);
  if (supabase) {
    let updateResult = await supabase
      .from('students')
      .update({ email_sent: sent })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateResult.error && (updateResult.error.code === 'PGRST204' || updateResult.error.code === '42703' || /email_sent/i.test(updateResult.error.message))) {
      const { data: studentRecord } = await supabase.from('students').select('note').eq('id', id).maybeSingle();
      const currentPayload = studentRecord ? parseStudentNotePayload(studentRecord.note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: currentPayload.text,
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved: currentPayload.linkApproved,
        inClass: currentPayload.inClass,
        emailSent: sent
      };
      const encryptedNote = encryptValue(JSON.stringify(newPayload), 'students.note');

      updateResult = await supabase
        .from('students')
        .update({ note: encryptedNote })
        .eq('id', id)
        .select()
        .maybeSingle();
    }

    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) return null;
    return mapStudent(updateResult.data);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE students SET email_sent = $1 WHERE id = $2 RETURNING *;`,
      [sent, id]
    );
    if (!rows.length) return null;
    return mapStudent(rows[0]);
  } catch (pgErr) {
    if (pgErr.code === '42703' || /email_sent/i.test(pgErr.message)) {
      const noteRes = await pool.query('SELECT note FROM students WHERE id = $1', [id]);
      const currentPayload = noteRes.rows[0] ? parseStudentNotePayload(noteRes.rows[0].note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: currentPayload.text,
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved: currentPayload.linkApproved,
        inClass: currentPayload.inClass,
        emailSent: sent
      };
      const encryptedNote = encryptValue(JSON.stringify(newPayload), 'students.note');

      const { rows } = await pool.query(
        `UPDATE students SET note = $1 WHERE id = $2 RETURNING *;`,
        [encryptedNote, id]
      );
      if (!rows.length) return null;
      return mapStudent(rows[0]);
    }
    throw pgErr;
  }
}

app.use(cors());
app.use(express.json());
const APP_VERSION = '2.4.0';

const userCache = new Map();
const USER_CACHE_TTL = 15000;

function invalidateUserCache(id) {
  if (id) {
    userCache.delete(String(id));
  } else {
    userCache.clear();
  }
}

const hasLocalFilesystem = typeof __dirname !== 'undefined';
if (hasLocalFilesystem) {
  app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.set('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  }));
}

const VALID_ROLES = ['superadmin', 'admin', 'deleg', 'staff'];
const isAdminRole = role => role === 'admin' || role === 'superadmin';
const isSuperAdminRole = role => role === 'superadmin';

async function getUserById(id) {
  if (!id) return null;
  const key = String(id);
  const cached = userCache.get(key);
  if (cached && (Date.now() - cached.timestamp < USER_CACHE_TTL)) {
    return cached.user;
  }
  let user = null;
  if (supabase) {
    const { data, error } = await supabase.from('users').select('id, username, full_name, role, approved').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const decryptedName = decryptValue(data.full_name, 'users.full_name');
    const parsed = parseUserFullNamePayload(decryptedName);
    const role = decryptValue(data.role, 'users.role');
    user = {
      id: data.id,
      username: decryptValue(data.username, 'users.username'),
      fullName: parsed.fullName,
      role,
      section: parsed.section || (role === 'superadmin' ? 'all' : 'mispce'),
      approved: data.approved !== false
    };
  } else {
    const { rows } = await pool.query(`SELECT id, username, full_name, role, approved FROM users WHERE id = $1`, [id]);
    if (!rows || !rows.length) return null;
    const u = rows[0];
    const decryptedName = decryptValue(u.full_name, 'users.full_name');
    const parsed = parseUserFullNamePayload(decryptedName);
    const role = decryptValue(u.role, 'users.role');
    user = {
      id: u.id,
      username: decryptValue(u.username, 'users.username'),
      fullName: parsed.fullName,
      role,
      section: parsed.section || (role === 'superadmin' ? 'all' : 'mispce'),
      approved: u.approved !== false
    };
  }
  if (user) {
    userCache.set(key, { user, timestamp: Date.now() });
  }
  return user;
}

const requireAdmin = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Please sign in again.' });
  if (!isAdminRole(session.role)) return res.status(403).json({ success: false, error: 'Administrator approval required' });
  req.session = session;
  res.set('Cache-Control', 'no-store');
  next();
};

// Kazaa report: authenticated access, with only origin text sent to Groq.
const { DISTRICTS, classifyOrigins } = require('./kazaa');
const requireSession = (req, res, next) => {
  const session = verifySession((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!session) return res.status(401).json({ success: false, error: 'Please sign in again to view students by kazaa.' });
  res.set('Cache-Control', 'no-store');
  next();
};
app.get('/api/kazaa', requireAdmin, async (req, res) => {
  try {
    let rows;
    if (supabase) {
      rows = [];
      for (let offset = 0; ; offset += 1000) {
        let { data, error } = await supabase.from('students').select('id, first_name, family_name, origin, kazaa').order('id').range(offset, offset + 999);
        if (error && (error.code === '42703' || /kazaa/i.test(error.message))) {
          const fallback = await supabase.from('students').select('id, first_name, family_name, origin').order('id').range(offset, offset + 999);
          if (fallback.error) throw fallback.error;
          data = fallback.data;
          error = null;
        }
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
    } else {
      try {
        ({ rows } = await pool.query('SELECT id, first_name, family_name, origin, kazaa FROM students ORDER BY id'));
      } catch {
        ({ rows } = await pool.query('SELECT id, first_name, family_name, origin FROM students ORDER BY id'));
      }
    }
    res.json({ success: true, configured: Boolean(process.env.GROQ_API_KEY), districts: DISTRICTS,
      data: rows.map(row => ({ id: row.id, firstName: decryptValue(row.first_name, 'students.first_name'), familyName: decryptValue(row.family_name, 'students.family_name'), origin: decryptValue(row.origin, 'students.origin'), kazaa: row.kazaa ? decryptValue(row.kazaa, 'students.kazaa') : '' })) });
  } catch {
    res.status(500).json({ success: false, error: 'Could not load students. Please reload to try again.' });
  }
});
app.post('/api/kazaa/classify', requireAdmin, async (req, res) => {
  const { origins } = req.body || {};
  if (!Array.isArray(origins) || !origins.length || origins.length > 30 || origins.some(value => typeof value !== 'string' || !value.trim() || value.length > 300)) {
    return res.status(400).json({ success: false, error: 'Send 1–30 origin names, up to 300 characters each.' });
  }
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ success: false, error: 'Groq is not configured. Add GROQ_API_KEY to Cloudflare secrets.' });
  try {
    const data = await classifyOrigins(origins, process.env.GROQ_API_KEY);
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.name === 'TimeoutError' ? 'Groq took too long. Please try again.' : err.message });
  }
});

app.post('/api/kazaa/batch', requireAdmin, async (req, res) => {
  const { assignments } = req.body || {};
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > 500) {
    return res.status(400).json({ success: false, error: 'Send an array of up to 500 assignments.' });
  }
  for (const item of assignments) {
    if (!item || typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
      return res.status(400).json({ success: false, error: 'Invalid student ID in batch.' });
    }
    if (item.district && !DISTRICTS.includes(item.district)) {
      return res.status(400).json({ success: false, error: `Invalid district: ${item.district}` });
    }
  }
  try {
    if (supabase) {
      for (const item of assignments) {
        const districtValue = item.district || '';
        const encrypted = districtValue ? encryptValue(districtValue, 'students.kazaa') : '';
        const { error } = await supabase.from('students').update({ kazaa: encrypted }).eq('id', item.id);
        if (error) throw error;
      }
    } else {
      for (const item of assignments) {
        const districtValue = item.district || '';
        const encrypted = districtValue ? encryptValue(districtValue, 'students.kazaa') : '';
        await pool.query('UPDATE students SET kazaa = $1 WHERE id = $2', [encrypted, item.id]);
      }
    }
    res.json({ success: true, count: assignments.length });
  } catch (err) {
    console.error('Error batch updating kazaa:', err.message);
    const needsMigration = err.code === '42703' || /kazaa/i.test(err.message);
    res.status(500).json({
      success: false,
      error: needsMigration
        ? 'Kazaa column is not enabled in the database yet. Run the migration in supabase_kazaa_migration.sql.'
        : 'Could not save kazaa assignments. Please try again.'
    });
  }
});

// Health & DB Status Endpoint
app.get('/api/db-status', async (req, res) => {
  const status = await checkDbConnection();
  res.json(status);
});

app.get('/api/backup/status', requireAdmin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), connected: Boolean(settings?.refresh_token), enabled: Boolean(settings?.enabled), retentionDays: settings?.retention_days || 30, lastBackupAt: settings?.last_backup_at || null, lastBackupName: settings?.last_backup_name || null, lastError: settings?.last_error || null });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/backup/connect', requireAdmin, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).json({ success: false, error: 'Google OAuth secrets are not configured in Cloudflare' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  res.json({ success: true, url: googleAuthorizationUrl(token) });
});

app.get('/api/google-drive/callback', async (req, res) => {
  const session = verifySession(req.query.state);
  if (!session || !isAdminRole(session.role)) return res.status(403).send('Invalid or expired administrator session.');
  try {
    if (!req.query.code) throw new Error(req.query.error || 'Google authorization was cancelled');
    await exchangeGoogleCode(req.query.code);
    res.redirect(302, '/backup.html?connected=1');
  } catch (error) { res.redirect(302, `/backup.html?error=${encodeURIComponent(error.message)}`); }
});

app.post('/api/backup/run', requireAdmin, async (req, res) => {
  try { res.json({ success: true, data: await runGoogleDriveBackup() }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.patch('/api/backup/settings', requireAdmin, async (req, res) => {
  const retentionDays = Number(req.body.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) return res.status(400).json({ success: false, error: 'Retention must be between 1 and 365 days' });
  const { error } = await supabase.from('backup_settings').update({ enabled: Boolean(req.body.enabled), retention_days: retentionDays }).eq('id', 1);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.use(['/api/students', '/api/users'], (req, res, next) => {
  if (supabaseRequested && !supabase) {
    return res.status(503).json({
      success: false,
      error: 'Supabase is configured but its API key is missing or invalid. Update the Supabase environment variables and restart the server.'
    });
  }
  next();
});

app.post('/api/users', async (req, res) => {
  const { fullName, username, password, role = 'deleg', section = 'mispce' } = req.body;
  if (!fullName || !username || !password) {
    return res.status(400).json({ success: false, error: 'Full name, username and password are required' });
  }
  if (username.trim().length < 3 || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Username must be at least 3 characters and password at least 8 characters' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid user role' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  const isSuperAdmin = Boolean(session && isSuperAdminRole(session.role));
  const isAdmin = Boolean(session && isAdminRole(session.role));

  if (role === 'superadmin' && !isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'Only superadministrators can grant the superadmin role' });
  }

  // Determine assigned role based on caller privileges
  let assignedRole = 'deleg';
  if (isSuperAdmin) {
    assignedRole = role === 'staff' ? 'deleg' : role;
  } else if (isAdmin) {
    assignedRole = (role === 'admin') ? 'admin' : 'deleg';
  } else {
    assignedRole = 'deleg';
  }
  let assignedSection = ['mispce', 'csvt', 'all'].includes(String(section || '').toLowerCase())
    ? String(section).toLowerCase()
    : 'mispce';
  if (assignedRole !== 'superadmin' && assignedSection === 'all') {
    assignedSection = 'mispce';
  }
  const isApproved = Boolean(isAdmin && req.body.approved === true);

  try {
    if (supabase) {
      const { data: existingUsers, error: lookupError } = await supabase.from('users').select('id, username');
      if (lookupError) throw lookupError;
      const duplicate = (existingUsers || []).some(user => decryptValue(user.username, 'users.username').toLowerCase() === username.trim().toLowerCase());
      if (duplicate) return res.status(409).json({ success: false, error: 'This username already exists' });
      const encryptedUser = {
        username: encryptValue(username.trim(), 'users.username'),
        password: hashPassword(password),
        full_name: encryptValue(buildUserFullNamePayload(fullName.trim(), assignedSection), 'users.full_name'),
        role: encryptValue(assignedRole, 'users.role'),
        approved: isApproved
      };
      const { data, error } = await supabase.from('users').insert(encryptedUser).select('id, username, full_name, role, approved').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ success: false, error: 'This username already exists' });
        throw error;
      }
      return res.status(201).json({
        success: true,
        provider: 'Supabase',
        data: { id: data.id, username: username.trim(), full_name: fullName.trim(), role: assignedRole, section: assignedSection, approved: isApproved },
        message: isApproved ? 'Portal user created successfully' : 'Portal user created and is waiting for administrator approval'
      });
    }
    const { rows } = await pool.query(
      `INSERT INTO users (username, password, full_name, role, approved) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name AS "fullName", role, approved`,
      [encryptValue(username.trim(), 'users.username'), hashPassword(password), encryptValue(buildUserFullNamePayload(fullName.trim(), assignedSection), 'users.full_name'), encryptValue(assignedRole, 'users.role'), isApproved]
    );
    return res.status(201).json({
      success: true,
      provider: 'PostgreSQL',
      data: { ...rows[0], fullName: fullName.trim(), section: assignedSection },
      message: isApproved ? 'Portal user created successfully' : 'Portal user created and is waiting for administrator approval'
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'This username already exists' });
    console.error('Error creating portal user:', err.message);
    return res.status(500).json({ success: false, error: 'Could not create portal user' });
  }
});

// Public registration request. Accounts remain disabled until an admin approves them.
app.post('/api/signup', async (req, res) => {
  const { fullName, username, password, section = 'mispce' } = req.body;
  if (!fullName || !username || !password || username.trim().length < 3 || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Enter a full name, username of at least 3 characters, and password of at least 8 characters' });
  }
  const assignedSection = ['mispce', 'csvt'].includes(String(section || '').toLowerCase()) ? String(section).toLowerCase() : 'mispce';
  try {
    const { data: users, error: lookupError } = await supabase.from('users').select('id, username');
    if (lookupError) throw lookupError;
    const duplicate = (users || []).some(user => decryptValue(user.username, 'users.username').toLowerCase() === username.trim().toLowerCase());
    if (duplicate) return res.status(409).json({ success: false, error: 'This username is already registered or awaiting approval' });
    const { error } = await supabase.from('users').insert({
      username: encryptValue(username.trim(), 'users.username'),
      password: hashPassword(password),
      full_name: encryptValue(buildUserFullNamePayload(fullName.trim(), assignedSection), 'users.full_name'),
      role: encryptValue('deleg', 'users.role'),
      approved: false
    });
    if (error) throw error;
    return res.status(201).json({ success: true, message: 'Your account request was sent for approval.' });
  } catch (err) {
    const migration = err.code === '42703' || /approved/i.test(err.message);
    return res.status(500).json({ success: false, error: migration ? 'Account approvals need the database migration before registration can open.' : 'Could not submit account request' });
  }
});

app.get('/api/users/pending', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id, username, full_name, role, created_at').eq('approved', false).order('created_at');
    if (error) throw error;
    return res.json({ success: true, data: (data || []).map(user => {
      const parsed = parseUserFullNamePayload(decryptValue(user.full_name, 'users.full_name'));
      const role = decryptValue(user.role, 'users.role');
      return {
        id: user.id,
        username: decryptValue(user.username, 'users.username'),
        fullName: parsed.fullName || decryptValue(user.username, 'users.username'),
        role,
        section: parsed.section || (role === 'superadmin' ? 'all' : 'mispce'),
        createdAt: user.created_at
      };
    }) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/users/all', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id, username, full_name, role, approved, created_at').order('created_at');
    if (error) throw error;
    return res.json({ success: true, data: (data || []).map(user => {
      const parsed = parseUserFullNamePayload(decryptValue(user.full_name, 'users.full_name'));
      const role = decryptValue(user.role, 'users.role');
      return {
        id: user.id,
        username: decryptValue(user.username, 'users.username'),
        fullName: parsed.fullName || decryptValue(user.username, 'users.username'),
        role,
        section: parsed.section || (role === 'superadmin' ? 'all' : 'mispce'),
        approved: user.approved !== false,
        createdAt: user.created_at
      };
    }) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/users/:id/approval', requireAdmin, async (req, res) => {
  const { approved } = req.body;
  if (typeof approved !== 'boolean') return res.status(400).json({ success: false, error: 'approved must be true or false' });
  try {
    const query = approved
      ? supabase.from('users').update({ approved: true }).eq('id', req.params.id).select('id').maybeSingle()
      : supabase.from('users').delete().eq('id', req.params.id).select('id').maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Request not found' });
    invalidateUserCache(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { fullName, username, role, section, approved, password } = req.body;
  if (!fullName || !username || username.trim().length < 3 || !VALID_ROLES.includes(role) || typeof approved !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Enter a valid name, username, role, and approval status' });
  }
  if (password && password.length < 8) return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  const isSuperAdmin = Boolean(session && isSuperAdminRole(session.role));

  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });

  if (session.id === req.params.id) {
    if (session.role === 'superadmin' && role !== 'superadmin') {
      return res.status(400).json({ success: false, error: 'You cannot demote your own superadministrator account' });
    }
    if (session.role === 'admin' && !isAdminRole(role)) {
      return res.status(400).json({ success: false, error: 'You cannot demote your own administrator account' });
    }
    if (!approved) {
      return res.status(400).json({ success: false, error: 'You cannot disable your own account' });
    }
  }

  if (!isSuperAdmin) {
    if (target.role === 'superadmin') {
      return res.status(403).json({ success: false, error: 'Only superadministrators can edit a superadministrator account' });
    }
    if (role === 'superadmin') {
      return res.status(403).json({ success: false, error: 'Only superadministrators can grant the superadmin role' });
    }
  }

  const assignedRole = role === 'staff' ? 'deleg' : role;
  let assignedSection = ['mispce', 'csvt', 'all'].includes(String(section || '').toLowerCase())
    ? String(section).toLowerCase()
    : (target.section || 'mispce');
  if (assignedRole !== 'superadmin' && assignedSection === 'all') {
    assignedSection = 'mispce';
  }

  try {
    const { data: users, error: lookupError } = await supabase.from('users').select('id, username');
    if (lookupError) throw lookupError;
    const duplicate = (users || []).some(user => user.id !== req.params.id && decryptValue(user.username, 'users.username').toLowerCase() === username.trim().toLowerCase());
    if (duplicate) return res.status(409).json({ success: false, error: 'This username already exists' });
    const update = {
      full_name: encryptValue(buildUserFullNamePayload(fullName.trim(), assignedSection), 'users.full_name'),
      username: encryptValue(username.trim(), 'users.username'),
      role: encryptValue(assignedRole, 'users.role'),
      approved
    };
    if (password) update.password = hashPassword(password);
    const { data, error } = await supabase.from('users').update(update).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'User not found' });
    invalidateUserCache(req.params.id);

    let freshToken = null;
    if (session && session.id === req.params.id) {
      freshToken = signSession({ id: req.params.id, role: assignedRole, section: assignedSection });
    }

    return res.json({
      success: true,
      data: { id: req.params.id, username: username.trim(), fullName: fullName.trim(), role: assignedRole, section: assignedSection, approved },
      token: freshToken
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (session.id === req.params.id) return res.status(400).json({ success: false, error: 'You cannot delete your own administrator account' });
  const isSuperAdmin = Boolean(session && isSuperAdminRole(session.role));
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.role === 'superadmin' && !isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'Only superadministrators can delete a superadministrator account' });
  }
  try {
    const { data, error } = await supabase.from('users').delete().eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'User not found' });
    invalidateUserCache(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// CURRENT SESSION / USER STATUS Endpoint
app.get('/api/auth/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session || !session.id) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });
  }

  try {
    const user = await getUserById(session.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User account no longer exists', unauthenticated: true });
    }
    if (user.approved === false) {
      return res.status(403).json({ success: false, error: 'Your account is waiting for administrator approval', unauthenticated: true });
    }

    const freshToken = signSession({
      id: user.id,
      role: user.role,
      section: user.section
    });

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName || user.username,
        role: user.role,
        section: user.section,
        approved: user.approved
      },
      token: freshToken,
      version: APP_VERSION
    });
  } catch (err) {
    console.error('Error in /api/auth/me:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// App Version endpoint for live deployment update detection
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, version: APP_VERSION });
});

// LOGIN Endpoint (Username & Password authentication against PostgreSQL)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  try {
    if (supabase) {
      const { data: users, error } = await supabase.from('users').select('id, username, password, full_name, role, approved');
      if (error) throw error;
      const data = (users || []).find(user => decryptValue(user.username, 'users.username').toLowerCase() === username.toLowerCase());
      if (!data || !verifyPassword(password, data.password)) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      if (data.approved === false) return res.status(403).json({ success: false, error: 'Your account is waiting for administrator approval' });
      if (!String(data.password).startsWith('scrypt:v1:')) {
        await supabase.from('users').update({ password: hashPassword(password) }).eq('id', data.id);
      }
      const decryptedUsername = decryptValue(data.username, 'users.username');
      const decryptedName = decryptValue(data.full_name, 'users.full_name');
      const parsed = parseUserFullNamePayload(decryptedName);
      const decryptedRole = decryptValue(data.role, 'users.role');
      const userSection = parsed.section || (decryptedRole === 'superadmin' ? 'all' : 'mispce');
      return res.json({
        success: true,
        message: 'Login successful',
        token: signSession({ id: data.id, role: decryptedRole, section: userSection }),
        user: { id: data.id, username: decryptedUsername, fullName: parsed.fullName || decryptedUsername, role: decryptedRole, section: userSection }
      });
    }
    const { rows } = await pool.query(`SELECT id, username, password, full_name AS "fullName", role, approved FROM users;`);
    const matched = rows.find(user => decryptValue(user.username, 'users.username').toLowerCase() === username.toLowerCase());

    if (!matched || !verifyPassword(password, matched.password)) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    if (matched.approved === false) {
      return res.status(403).json({ success: false, error: 'Your account is waiting for administrator approval' });
    }

    const user = matched;
    if (!String(user.password).startsWith('scrypt:v1:')) {
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(password), user.id]);
    }
    delete user.password;

    const decryptedUsername = decryptValue(user.username, 'users.username');
    const decryptedName = decryptValue(user.fullName, 'users.full_name');
    const parsed = parseUserFullNamePayload(decryptedName);
    const decryptedRole = decryptValue(user.role, 'users.role');
    const userSection = parsed.section || (decryptedRole === 'superadmin' ? 'all' : 'mispce');

    res.json({
      success: true,
      message: 'Login successful',
      token: signSession({ id: user.id, role: decryptedRole, section: userSection }),
      user: {
        id: user.id,
        username: decryptedUsername,
        fullName: parsed.fullName || decryptedUsername,
        role: decryptedRole,
        section: userSection
      }
    });
  } catch (err) {
    console.error('Error during login:', err.message);
    res.status(500).json({ success: false, error: 'Authentication error' });
  }
});

// GET all students
app.get('/api/students', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  let callerRole = session ? (session.role || 'deleg').toLowerCase() : null;
  let callerSection = session ? (session.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase() : 'all';
  let isDeleg = Boolean(session && session.role === 'deleg');

  if (session && session.id) {
    try {
      const liveUser = await getUserById(session.id);
      if (liveUser && liveUser.approved !== false) {
        callerRole = (liveUser.role || 'deleg').toLowerCase();
        callerSection = (liveUser.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();
        isDeleg = callerRole === 'deleg';
      }
    } catch {}
  }
  const querySection = req.query.section ? String(req.query.section).toLowerCase() : null;

  try {
    let studentList = [];
    if (supabase) {
      const { data, error } = await supabase.from('students').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      studentList = (data || []).filter(r => !isSystemStudent(r)).map(mapStudent);
    } else {
      const { rows } = await pool.query(`
        SELECT 
          note,
          kazaa,
          id, 
          first_name AS "firstName", 
          father_name AS "fatherName", 
          family_name AS "familyName", 
          origin, 
          address, 
          school, 
          major, 
          political_affiliation AS "politicalAffiliation",
          status, 
          language, 
          campus, 
          phone, 
          email, 
          in_group AS "inGroup",
          left_group AS "leftGroup",
          created_at AS "createdAt"
        FROM students 
        ORDER BY created_at DESC;
      `);
      studentList = rows.map(row => {
        const mapped = mapStudent(row);
        return {
          ...row,
          ...mapped,
          note: readStudentNote(row.note),
          kazaa: row.kazaa ? decryptValue(row.kazaa, 'students.kazaa') : '',
          section: mapped.section,
          linkApproved: mapped.linkApproved,
          inClass: mapped.inClass,
          emailSent: mapped.emailSent,
          assignedGroup: mapped.assignedGroup
        };
      });
    }

    // Filter by section
    if (callerRole === 'deleg' || (callerRole === 'admin' && callerSection !== 'all')) {
      studentList = studentList.filter(s => s.section === callerSection);
    } else if (querySection && ['mispce', 'csvt'].includes(querySection)) {
      studentList = studentList.filter(s => s.section === querySection);
    }

    if (isDeleg) {
      studentList = studentList.map(s => ({ ...s, politicalAffiliation: '', note: '' }));
    }

    return res.json({ success: true, data: studentList });
  } catch (err) {
    console.error('Error fetching students:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to escape special characters for vCard RFC 2426
function escapeVCardValue(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Generate valid vCard 3.0 string for iOS / iPhone and Android contact import
function generateVCardString(student) {
  const firstName = (student.firstName || '').trim();
  const fatherName = (student.fatherName || '').trim();
  const familyName = (student.familyName || '').trim();
  const fullName = [firstName, fatherName, familyName].filter(Boolean).join(' ') || 'Student';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCardValue(familyName)};${escapeVCardValue(firstName)};${escapeVCardValue(fatherName)};;`,
    `FN:${escapeVCardValue(fullName)}`
  ];

  if (student.phone) {
    lines.push(`TEL;TYPE=CELL,VOICE:${String(student.phone).trim()}`);
  }

  if (student.email) {
    lines.push(`EMAIL;TYPE=INTERNET,HOME:${String(student.email).trim()}`);
  }

  const school = (student.school || '').trim();
  const campus = (student.campus || '').trim();
  if (school || campus) {
    const org = [school, campus].filter(Boolean).join(' - ');
    lines.push(`ORG:${escapeVCardValue(org)}`);
  }

  const major = (student.major || '').trim();
  const sec = (student.section || inferSectionFromMajor(student.major) || '').toUpperCase();
  if (major || sec) {
    const title = [major, sec].filter(Boolean).join(' • ');
    lines.push(`TITLE:${escapeVCardValue(title)}`);
  }

  if (student.address || student.origin) {
    const street = student.address ? escapeVCardValue(student.address) : '';
    const locality = student.origin ? escapeVCardValue(student.origin) : '';
    lines.push(`ADR;TYPE=HOME:;;${street};${locality};;;`);
  }

  const noteParts = [];
  if (student.status) noteParts.push(`Status: ${student.status}`);
  if (student.language) noteParts.push(`Language: ${student.language}`);
  if (student.origin) noteParts.push(`Origin: ${student.origin}`);
  if (student.assignedGroup) noteParts.push(`Group: ${student.assignedGroup}`);
  if (student.note) noteParts.push(`Note: ${student.note}`);
  if (noteParts.length) {
    lines.push(`NOTE:${escapeVCardValue(noteParts.join(' | '))}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

app.generateVCardString = generateVCardString;

// GET batch export contacts as vCard (.vcf) - Superadmin only (registered before /:id routes)
app.get('/api/students/export/vcard', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  let callerRole = (session.role || 'deleg').toLowerCase();
  if (session.id) {
    try {
      const liveUser = await getUserById(session.id);
      if (liveUser && liveUser.approved !== false) {
        callerRole = (liveUser.role || 'deleg').toLowerCase();
      }
    } catch {}
  }

  if (callerRole !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Forbidden: Superadmin privileges required to export contacts.' });
  }

  const statusFilter = (req.query.status || 'both').toLowerCase();
  const idFilter = req.query.ids ? String(req.query.ids).split(',').map(s => s.trim()).filter(Boolean) : null;

  try {
    let studentList = [];
    if (supabase) {
      const { data, error } = await supabase.from('students').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      studentList = (data || []).filter(r => !isSystemStudent(r)).map(mapStudent);
    } else {
      const { rows } = await pool.query(`
        SELECT 
          note, kazaa, id, first_name AS "firstName", father_name AS "fatherName", family_name AS "familyName",
          origin, address, school, major, political_affiliation AS "politicalAffiliation",
          status, language, campus, phone, email, in_group AS "inGroup", left_group AS "leftGroup", created_at AS "createdAt"
        FROM students 
        ORDER BY created_at DESC;
      `);
      studentList = rows.map(row => {
        const mapped = mapStudent(row);
        return {
          ...row,
          note: readStudentNote(row.note),
          kazaa: row.kazaa ? decryptValue(row.kazaa, 'students.kazaa') : '',
          section: mapped.section
        };
      });
    }

    let filtered = studentList;
    if (statusFilter === 'new') {
      filtered = filtered.filter(s => String(s.status || '').trim().toLowerCase() === 'new');
    } else if (statusFilter === 'mu3id') {
      filtered = filtered.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id');
    }

    if (idFilter && idFilter.length) {
      const idSet = new Set(idFilter);
      filtered = filtered.filter(s => idSet.has(String(s.id)));
    }

    const combined = filtered.map(generateVCardString).join('');
    const filename = `students_vcard_${statusFilter}_${filtered.length}.vcf`;

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(combined);
  } catch (err) {
    console.error('Error exporting vCard batch:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export vCards' });
  }
});

// GET single student by ID
app.get('/api/students/:id', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  let callerRole = session ? (session.role || 'deleg').toLowerCase() : null;
  let callerSection = session ? (session.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase() : 'all';
  let isDeleg = Boolean(session && session.role === 'deleg');

  if (session && session.id) {
    try {
      const liveUser = await getUserById(session.id);
      if (liveUser && liveUser.approved !== false) {
        callerRole = (liveUser.role || 'deleg').toLowerCase();
        callerSection = (liveUser.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();
        isDeleg = callerRole === 'deleg';
      }
    } catch {}
  }

  try {
    const { id } = req.params;
    let mapped = null;
    if (supabase) {
      const { data, error } = await supabase.from('students').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Student not found' });
      mapped = mapStudent(data);
    } else {
      const { rows } = await pool.query(`
        SELECT 
          note,
          kazaa,
          id, 
          first_name AS "firstName", 
          father_name AS "fatherName", 
          family_name AS "familyName", 
          origin, 
          address, 
          school, 
          major, 
          political_affiliation AS "politicalAffiliation",
          status, 
          language, 
          campus, 
          phone, 
          email, 
          in_group AS "inGroup",
          left_group AS "leftGroup",
          created_at AS "createdAt"
        FROM students 
        WHERE id = $1;
      `, [id]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Student not found' });
      }
      mapped = mapStudent(rows[0]);
    }

    if (callerRole === 'deleg' || (callerRole === 'admin' && callerSection !== 'all')) {
      if (mapped.section !== callerSection) {
        return res.status(404).json({ success: false, error: 'Student not found in your section' });
      }
    }

    if (isDeleg) {
      mapped.politicalAffiliation = '';
      mapped.note = '';
    }
    res.json({ success: true, data: mapped });
  } catch (err) {
    console.error('Error fetching student:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to escape special characters for vCard RFC 2426
function escapeVCardValue(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Generate valid vCard 3.0 string for iOS / iPhone and Android contact import
function generateVCardString(student) {
  const firstName = (student.firstName || '').trim();
  const fatherName = (student.fatherName || '').trim();
  const familyName = (student.familyName || '').trim();
  const fullName = [firstName, fatherName, familyName].filter(Boolean).join(' ') || 'Student';

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCardValue(familyName)};${escapeVCardValue(firstName)};${escapeVCardValue(fatherName)};;`,
    `FN:${escapeVCardValue(fullName)}`
  ];

  if (student.phone) {
    lines.push(`TEL;TYPE=CELL,VOICE:${String(student.phone).trim()}`);
  }

  if (student.email) {
    lines.push(`EMAIL;TYPE=INTERNET,HOME:${String(student.email).trim()}`);
  }

  const school = (student.school || '').trim();
  const campus = (student.campus || '').trim();
  if (school || campus) {
    const org = [school, campus].filter(Boolean).join(' - ');
    lines.push(`ORG:${escapeVCardValue(org)}`);
  }

  const major = (student.major || '').trim();
  const sec = (student.section || inferSectionFromMajor(student.major) || '').toUpperCase();
  if (major || sec) {
    const title = [major, sec].filter(Boolean).join(' • ');
    lines.push(`TITLE:${escapeVCardValue(title)}`);
  }

  if (student.address || student.origin) {
    const street = student.address ? escapeVCardValue(student.address) : '';
    const locality = student.origin ? escapeVCardValue(student.origin) : '';
    lines.push(`ADR;TYPE=HOME:;;${street};${locality};;;`);
  }

  const noteParts = [];
  if (student.status) noteParts.push(`Status: ${student.status}`);
  if (student.language) noteParts.push(`Language: ${student.language}`);
  if (student.origin) noteParts.push(`Origin: ${student.origin}`);
  if (student.assignedGroup) noteParts.push(`Group: ${student.assignedGroup}`);
  if (student.note) noteParts.push(`Note: ${student.note}`);
  if (noteParts.length) {
    lines.push(`NOTE:${escapeVCardValue(noteParts.join(' | '))}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

app.generateVCardString = generateVCardString;

// Serve vCard (.vcf) file for iPhone / iOS and mobile/desktop contacts
async function handleVCardRequest(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) {
    return res.status(401).send('Unauthorized');
  }

  let callerRole = session ? (session.role || 'deleg').toLowerCase() : null;
  let callerSection = session ? (session.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase() : 'all';

  if (session && session.id) {
    try {
      const liveUser = await getUserById(session.id);
      if (liveUser && liveUser.approved !== false) {
        callerRole = (liveUser.role || 'deleg').toLowerCase();
        callerSection = (liveUser.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();
      }
    } catch {}
  }

  try {
    const { id } = req.params;
    let mapped = null;
    if (supabase) {
      const { data, error } = await supabase.from('students').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).send('Student not found');
      mapped = mapStudent(data);
    } else {
      const { rows } = await pool.query(`
        SELECT 
          note,
          kazaa,
          id, 
          first_name AS "firstName", 
          father_name AS "fatherName", 
          family_name AS "familyName", 
          origin, 
          address, 
          school, 
          major, 
          political_affiliation AS "politicalAffiliation",
          status, 
          language, 
          campus, 
          phone, 
          email, 
          in_group AS "inGroup",
          left_group AS "leftGroup",
          created_at AS "createdAt"
        FROM students 
        WHERE id = $1;
      `, [id]);

      if (rows.length === 0) {
        return res.status(404).send('Student not found');
      }
      mapped = mapStudent(rows[0]);
    }

    if (callerRole === 'deleg' || (callerRole === 'admin' && callerSection !== 'all')) {
      if (mapped.section !== callerSection) {
        return res.status(403).send('Student not found in your section');
      }
    }

    // Never leak confidential admin note to delegates via contact card
    if (callerRole === 'deleg') {
      mapped.politicalAffiliation = '';
      mapped.note = '';
    }

    const vcard = generateVCardString(mapped);
    const cleanFirst = (mapped.firstName || 'Student').trim().replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
    const cleanFamily = (mapped.familyName || '').trim().replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
    const filename = `${cleanFirst}${cleanFamily ? '_' + cleanFamily : ''}.vcf`;

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(vcard);
  } catch (err) {
    console.error('Error generating vCard:', err.message);
    res.status(500).send('Error generating contact card');
  }
}

app.get('/api/students/:id/vcard', handleVCardRequest);
app.get('/api/students/:id/contact.vcf', handleVCardRequest);

// POST create new student (Admins, Superadmins, and Delegates can add students)
app.post('/api/students', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Please sign in to add a student.' });
  }

  const callerRole = (session.role || 'deleg').toLowerCase();
  const callerSection = (session.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();

  const { firstName, fatherName, familyName, origin, address, school, major, politicalAffiliation, status, language, campus, phone, email, section } = req.body;

  if (!firstName || !fatherName || !familyName || !school || !major || !status || !language || !campus || !phone || !email) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // Determine target section
  let targetSection = 'mispce';
  if (callerRole === 'deleg' || (callerRole === 'admin' && callerSection !== 'all')) {
    targetSection = callerSection;
  } else {
    targetSection = section && ['mispce', 'csvt'].includes(String(section).toLowerCase())
      ? String(section).toLowerCase()
      : inferSectionFromMajor(major);
  }

  // Validate that major belongs to targetSection
  const normMajor = String(major).trim().toLowerCase();
  const allowedMajors = targetSection === 'csvt' ? CSVT_MAJORS : MISPCE_MAJORS;
  const isAllowed = allowedMajors.some(m => normMajor.includes(m) || m.includes(normMajor));
  if (!isAllowed) {
    return res.status(400).json({
      success: false,
      error: `Selected major "${major}" is not offered in section ${targetSection.toUpperCase()}`
    });
  }

  const cleanAffiliation = callerRole === 'deleg' ? '' : (politicalAffiliation || '');
  const studentPayload = {
    ...req.body,
    section: targetSection,
    politicalAffiliation: cleanAffiliation
  };

  try {
    const duplicateField = await findDuplicateStudent(studentPayload);
    if (duplicateField) {
      return res.status(409).json({
        success: false,
        error: `This student already exists (matching ${duplicateField})`
      });
    }

    if (supabase) {
      const { data, error } = await supabase.from('students').insert(toStudentRow(studentPayload)).select().single();
      if (error) throw error;
      const mapped = mapStudent(data);
      if (callerRole === 'deleg') {
        mapped.politicalAffiliation = '';
        mapped.note = '';
      }
      return res.status(201).json({ success: true, provider: 'Supabase', data: mapped, message: 'Student created successfully in Supabase' });
    }
    const encrypted = toStudentRow(studentPayload);
    const { rows } = await pool.query(
      `INSERT INTO students 
        (first_name, father_name, family_name, origin, address, school, major, political_affiliation, status, language, campus, phone, email, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING 
        id, 
        first_name AS "firstName", 
        father_name AS "fatherName", 
        family_name AS "familyName", 
        origin, 
        address, 
        school, 
        major, 
        political_affiliation AS "politicalAffiliation",
        status, 
        language, 
        campus, 
        phone, 
        email, 
        in_group AS "inGroup",
        left_group AS "leftGroup",
        note,
        created_at AS "createdAt";`,
      [encrypted.first_name, encrypted.father_name, encrypted.family_name, encrypted.origin, encrypted.address, encrypted.school, encrypted.major, encrypted.political_affiliation, encrypted.status, encrypted.language, encrypted.campus, encrypted.phone, encrypted.email, encrypted.note]
    );

    const mapped = mapStudent(rows[0]);
    if (callerRole === 'deleg') {
      mapped.politicalAffiliation = '';
      mapped.note = '';
    }
    res.status(201).json({ success: true, provider: 'PostgreSQL', data: mapped, message: 'Student created successfully' });
  } catch (err) {
    console.error('Error creating student:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update student
app.put('/api/students/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { firstName, fatherName, familyName, origin, address, school, major, politicalAffiliation, status, language, campus, phone, email } = req.body;

  if (!firstName || !fatherName || !familyName || !school || !major || !status || !language || !campus || !phone || !email) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const duplicateField = await findDuplicateStudent(req.body, id);
    if (duplicateField) {
      return res.status(409).json({
        success: false,
        error: `Another student already exists with this ${duplicateField}`
      });
    }

    let studentPayload = { ...req.body };
    if (supabase) {
      const { data: cur } = await supabase.from('students').select('note').eq('id', id).maybeSingle();
      const curPayload = cur ? parseStudentNotePayload(cur.note) : { text: '', assignedGroup: '', section: '', inClass: false, emailSent: false };
      studentPayload.note = req.body.note !== undefined ? req.body.note : curPayload.text;
      studentPayload.assignedGroup = curPayload.assignedGroup;
      studentPayload.section = req.body.section || curPayload.section || inferSectionFromMajor(major);
      studentPayload.inClass = req.body.inClass !== undefined ? Boolean(req.body.inClass) : curPayload.inClass;
      studentPayload.emailSent = req.body.emailSent !== undefined ? Boolean(req.body.emailSent) : Boolean(curPayload.emailSent);

      const { data, error } = await supabase.from('students').update(toStudentRow(studentPayload)).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Student not found' });
      return res.json({ success: true, data: mapStudent(data), message: 'Student updated successfully' });
    }
    const encrypted = toStudentRow(studentPayload);
    const { rows } = await pool.query(
      `UPDATE students 
       SET first_name = $1, 
           father_name = $2, 
           family_name = $3, 
           origin = $4,
           address = $5,
           school = $6,
           major = $7,
           political_affiliation = $8,
           status = $9,
           language = $10,
           campus = $11,
           phone = $12,
           email = $13,
           note = $14
       WHERE id = $15
       RETURNING 
        id, 
        first_name AS "firstName", 
        father_name AS "fatherName", 
        family_name AS "familyName", 
        origin, 
        address, 
        school, 
        major, 
        political_affiliation AS "politicalAffiliation",
        status, 
        language, 
        campus, 
        phone, 
        email, 
        in_group AS "inGroup",
        left_group AS "leftGroup",
        note,
        created_at AS "createdAt";`,
      [encrypted.first_name, encrypted.father_name, encrypted.family_name, encrypted.origin, encrypted.address, encrypted.school, encrypted.major, encrypted.political_affiliation, encrypted.status, encrypted.language, encrypted.campus, encrypted.phone, encrypted.email, encrypted.note, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    res.json({ success: true, data: mapStudent(rows[0]), message: 'Student updated successfully' });
  } catch (err) {
    console.error('Error updating student:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update only the selected student's note; normal profile edits preserve it.
app.patch('/api/students/:id/note', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid student ID.' });
  }
  const { note } = req.body || {};
  if (typeof note !== 'string' || note.length > 5000) {
    return res.status(400).json({ success: false, error: 'Note must be text of at most 5,000 characters.' });
  }
  try {
    let row;
    if (supabase) {
      const { data: studentRecord } = await supabase.from('students').select('note').eq('id', id).maybeSingle();
      const currentPayload = studentRecord ? parseStudentNotePayload(studentRecord.note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: note.trim(),
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved: currentPayload.linkApproved,
        inClass: currentPayload.inClass,
        emailSent: Boolean(currentPayload.emailSent)
      };
      const encrypted = (newPayload.text || newPayload.assignedGroup || newPayload.section || newPayload.linkApproved || newPayload.emailSent)
        ? encryptValue(JSON.stringify(newPayload), 'students.note')
        : '';
      const { data, error } = await supabase.from('students').update({ note: encrypted }).eq('id', id).select('id').maybeSingle();
      if (error) throw error;
      row = data;
    } else {
      const noteRes = await pool.query('SELECT note FROM students WHERE id = $1', [id]);
      const currentPayload = noteRes.rows[0] ? parseStudentNotePayload(noteRes.rows[0].note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
      const newPayload = {
        text: note.trim(),
        assignedGroup: currentPayload.assignedGroup || '',
        section: currentPayload.section || '',
        linkApproved: currentPayload.linkApproved,
        inClass: currentPayload.inClass,
        emailSent: Boolean(currentPayload.emailSent)
      };
      const encrypted = (newPayload.text || newPayload.assignedGroup || newPayload.section || newPayload.linkApproved || newPayload.emailSent)
        ? encryptValue(JSON.stringify(newPayload), 'students.note')
        : '';
      const { rows } = await pool.query('UPDATE students SET note = $1 WHERE id = $2 RETURNING id', [encrypted, id]);
      row = rows[0];
    }
    if (!row) return res.status(404).json({ success: false, error: 'Student not found.' });
    res.json({ success: true, data: { id: row.id, note: note.trim() } });
  } catch (err) {
    console.error('Error saving student note:', err.message);
    res.status(500).json({ success: false, error: 'Could not save the note. Please try again.' });
  }
});

// Update only the selected student's kazaa (district); normal profile edits preserve it.
app.patch('/api/students/:id/kazaa', async (req, res) => {
  const session = verifySession((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!session) return res.status(401).json({ success: false, error: 'Please sign in again to save kazaa.' });
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ success: false, error: 'Invalid student ID.' });
  }
  const { kazaa } = req.body || {};
  const districtValue = typeof kazaa === 'string' ? kazaa.trim() : '';
  if (districtValue && !DISTRICTS.includes(districtValue)) {
    return res.status(400).json({ success: false, error: 'Invalid kazaa district.' });
  }
  const encrypted = districtValue ? encryptValue(districtValue, 'students.kazaa') : '';
  try {
    let row;
    if (supabase) {
      const { data, error } = await supabase.from('students').update({ kazaa: encrypted }).eq('id', id).select('id').maybeSingle();
      if (error) throw error;
      row = data;
    } else {
      const { rows } = await pool.query('UPDATE students SET kazaa = $1 WHERE id = $2 RETURNING id', [encrypted, id]);
      row = rows[0];
    }
    if (!row) return res.status(404).json({ success: false, error: 'Student not found.' });
    res.json({ success: true, data: { id: row.id, kazaa: districtValue } });
  } catch (err) {
    console.error('Error saving student kazaa:', err.message);
    const needsMigration = err.code === '42703' || /kazaa/i.test(err.message);
    res.status(500).json({
      success: false,
      error: needsMigration
        ? 'Kazaa column is not enabled in the database yet. Run the migration in supabase_kazaa_migration.sql.'
        : 'Could not save kazaa. Please try again.'
    });
  }
});

// PATCH group membership without changing the rest of the student record
app.patch('/api/students/:id/group', async (req, res) => {
  const { id } = req.params;
  const { inGroup, leftGroup = false, assignedGroup } = req.body;
  if (typeof inGroup !== 'boolean') {
    return res.status(400).json({ success: false, error: 'inGroup must be true or false' });
  }
  if (typeof leftGroup !== 'boolean') {
    return res.status(400).json({ success: false, error: 'leftGroup must be true or false' });
  }
  if (assignedGroup !== undefined && typeof assignedGroup !== 'string') {
    return res.status(400).json({ success: false, error: 'assignedGroup must be a string' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (session && (session.role === 'deleg' || (session.role === 'admin' && session.section !== 'all'))) {
    const callerSection = session.section || 'mispce';
    if (supabase) {
      const { data: checkStudent } = await supabase.from('students').select('note, major').eq('id', id).maybeSingle();
      if (checkStudent) {
        const studentSection = parseStudentNotePayload(checkStudent.note).section || inferSectionFromMajor(checkStudent.major);
        if (studentSection !== callerSection) {
          return res.status(403).json({ success: false, error: 'Cannot modify students outside your section' });
        }
      }
    }
  }

  const nextInGroup = leftGroup ? false : inGroup;
  const nextAssignedGroup = leftGroup ? '' : (assignedGroup !== undefined ? assignedGroup.trim() : undefined);

  try {
    if (supabase) {
      let updatePayload = { in_group: nextInGroup, left_group: leftGroup };
      if (nextAssignedGroup !== undefined) {
        updatePayload.assigned_group = nextAssignedGroup ? encryptValue(nextAssignedGroup, 'students.assigned_group') : '';
      }

      let updateResult = await supabase
        .from('students')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .maybeSingle();

      // If assigned_group column is not present in Supabase table (PGRST204 or 42703), fallback to note payload
      if (updateResult.error && (updateResult.error.code === 'PGRST204' || updateResult.error.code === '42703' || /assigned_group/i.test(updateResult.error.message))) {
        const { data: studentRecord } = await supabase.from('students').select('note').eq('id', id).maybeSingle();
        const currentPayload = studentRecord ? parseStudentNotePayload(studentRecord.note) : { text: '', assignedGroup: '', section: '', linkApproved: false, inClass: false, emailSent: false };
        const newPayload = {
          text: currentPayload.text,
          assignedGroup: nextAssignedGroup !== undefined ? nextAssignedGroup : (currentPayload.assignedGroup || ''),
          section: currentPayload.section || '',
          linkApproved: currentPayload.linkApproved,
          inClass: currentPayload.inClass || false,
          emailSent: Boolean(currentPayload.emailSent)
        };
        const encryptedNote = (newPayload.text || newPayload.assignedGroup || newPayload.section || newPayload.inClass || newPayload.emailSent)
          ? encryptValue(JSON.stringify(newPayload), 'students.note')
          : '';

        updateResult = await supabase
          .from('students')
          .update({ in_group: nextInGroup, left_group: leftGroup, note: encryptedNote })
          .eq('id', id)
          .select()
          .maybeSingle();
      }

      if (updateResult.error) throw updateResult.error;
      if (!updateResult.data) return res.status(404).json({ success: false, error: 'Student not found' });
      return res.json({ success: true, data: mapStudent(updateResult.data) });
    }

    // Postgres pool handling
    try {
      const { rows } = await pool.query(
        `UPDATE students SET in_group = $1, left_group = $2, assigned_group = $3 WHERE id = $4
         RETURNING id, in_group AS "inGroup", left_group AS "leftGroup", assigned_group AS "assignedGroup";`,
        [nextInGroup, leftGroup, nextAssignedGroup || '', id]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Student not found' });
      return res.json({ success: true, data: rows[0] });
    } catch (pgErr) {
      if (pgErr.code === '42703' || /assigned_group/i.test(pgErr.message)) {
        const noteRes = await pool.query('SELECT note FROM students WHERE id = $1', [id]);
        const currentPayload = noteRes.rows[0] ? parseStudentNotePayload(noteRes.rows[0].note) : { text: '', linkApproved: false, inClass: false, emailSent: false };
        const newPayload = {
          text: currentPayload.text,
          assignedGroup: nextAssignedGroup !== undefined ? nextAssignedGroup : (currentPayload.assignedGroup || ''),
          section: currentPayload.section || '',
          linkApproved: currentPayload.linkApproved,
          inClass: currentPayload.inClass || false,
          emailSent: Boolean(currentPayload.emailSent)
        };
        const encryptedNote = (newPayload.text || newPayload.assignedGroup || newPayload.inClass || newPayload.emailSent)
          ? encryptValue(JSON.stringify(newPayload), 'students.note')
          : '';

        const { rows } = await pool.query(
          `UPDATE students SET in_group = $1, left_group = $2, note = $3 WHERE id = $4
           RETURNING id, in_group AS "inGroup", left_group AS "leftGroup";`,
          [nextInGroup, leftGroup, encryptedNote, id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'Student not found' });
        return res.json({ success: true, data: { ...rows[0], assignedGroup: newPayload.assignedGroup } });
      }
      throw pgErr;
    }
  } catch (err) {
    console.error('Error updating group membership:', err.message);
    const needsMigration = err.code === '42703' || /in_group|left_group/i.test(err.message);
    return res.status(500).json({
      success: false,
      error: needsMigration
        ? 'Group membership is not enabled in the database yet. Run the migration in supabase_schema.sql.'
        : err.message
    });
  }
});

// PATCH student link approval (linkApproved / inClass) without modifying other fields
app.patch(['/api/students/:id/link-approval', '/api/students/:id/class'], async (req, res) => {
  const { id } = req.params;
  const linkApproved = typeof req.body.linkApproved === 'boolean'
    ? req.body.linkApproved
    : (typeof req.body.inClass === 'boolean' ? req.body.inClass : undefined);

  if (typeof linkApproved !== 'boolean') {
    return res.status(400).json({ success: false, error: 'linkApproved must be true or false' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (session && (session.role === 'deleg' || (session.role === 'admin' && session.section !== 'all'))) {
    const callerSection = session.section || 'mispce';
    if (supabase) {
      const { data: checkStudent } = await supabase.from('students').select('note, major').eq('id', id).maybeSingle();
      if (checkStudent) {
        const studentSection = parseStudentNotePayload(checkStudent.note).section || inferSectionFromMajor(checkStudent.major);
        if (studentSection !== callerSection) {
          return res.status(403).json({ success: false, error: 'Cannot modify students outside your section' });
        }
      }
    }
  }

  try {
    const updated = await setStudentApprovalState(id, linkApproved);
    if (!updated) return res.status(404).json({ success: false, error: 'Student not found' });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Error updating approval:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH student email sent state without modifying other fields
app.patch('/api/students/:id/email-sent', async (req, res) => {
  const { id } = req.params;
  const emailSent = typeof req.body.emailSent === 'boolean'
    ? req.body.emailSent
    : (typeof req.body.email_sent === 'boolean' ? req.body.email_sent : undefined);

  if (typeof emailSent !== 'boolean') {
    return res.status(400).json({ success: false, error: 'emailSent must be true or false' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Please sign in again.' });
  }

  if (session && (session.role === 'deleg' || (session.role === 'admin' && session.section !== 'all'))) {
    const callerSection = session.section || 'mispce';
    if (supabase) {
      const { data: checkStudent } = await supabase.from('students').select('note, major').eq('id', id).maybeSingle();
      if (checkStudent) {
        const studentSection = parseStudentNotePayload(checkStudent.note).section || inferSectionFromMajor(checkStudent.major);
        if (studentSection !== callerSection) {
          return res.status(403).json({ success: false, error: 'Cannot modify students outside your section' });
        }
      }
    }
  }

  try {
    const updated = await setStudentEmailSentState(id, emailSent);
    if (!updated) return res.status(404).json({ success: false, error: 'Student not found' });
    return res.json({ success: true, data: updated, emailSent: updated.emailSent });
  } catch (err) {
    console.error('Error updating emailSent:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET email subsystem status
app.get('/api/email/status', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });
  return res.json({ success: true, ...getMailerStatus() });
});

// GET email and group invitation configuration settings (Admin/Superadmin only)
app.get('/api/email/settings', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const role = (session.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Access restricted to administrators' });
  }

  if (typeof syncEmailSettingsFromDb === 'function') {
    await syncEmailSettingsFromDb();
  }
  const settings = getEffectiveSettings();
  return res.json({ success: true, settings });
});

// POST save email and group invitation configuration settings (Admin/Superadmin only)
app.post('/api/email/settings', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const role = (session.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Access restricted to administrators' });
  }

  try {
    const updated = await saveEmailSettings(req.body || {});
    return res.json({ success: true, settings: updated, message: 'Email and group configuration saved successfully.' });
  } catch (err) {
    console.error('Error saving email settings:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST send a test email to verify SMTP delivery (Admin/Superadmin only)
app.post('/api/email/test-connection', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const role = (session.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Access restricted to administrators' });
  }

  const { testEmail, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, emailFrom } = req.body || {};
  if (!testEmail || !testEmail.includes('@')) {
    return res.status(400).json({ success: false, error: 'Please specify a valid test recipient email address' });
  }

  let overrideConfig = null;
  if (smtpHost && smtpUser) {
    const portNum = smtpPort ? parseInt(smtpPort, 10) : 465;
    overrideConfig = {
      host: smtpHost.trim(),
      port: portNum,
      secure: smtpSecure !== undefined ? Boolean(smtpSecure) : (portNum === 465),
      user: smtpUser.trim(),
      pass: smtpPass || '',
      from: emailFrom || ''
    };
  }

  try {
    const senderName = session.fullName || 'ULFS2 Administrator';
    const result = await sendTestEmail({ to: testEmail.trim(), senderName, overrideConfig });
    return res.json({
      success: true,
      message: `Test email dispatched to ${testEmail}. Check your inbox!`,
      ...result
    });
  } catch (err) {
    console.error('Error sending test email:', err.message);
    let userFriendlyError = err.message || 'Error communicating with outgoing email server';
    if (/TLS Handshake Failed/i.test(userFriendlyError)) {
      userFriendlyError = 'TLS Handshake Failed: Port 587 (STARTTLS) is not supported by Cloudflare Workers. Please change Port to 465 and Security to SSL/TLS (465) in the form above and click Send Test Email.';
    }
    return res.status(500).json({
      success: false,
      error: userFriendlyError,
      code: err.code || 'EMAIL_SEND_FAILED'
    });
  }
});

// POST email template live preview
app.post('/api/email/preview', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  try {
    const { studentId, student: providedStudent, groupName, joinUrl, customMessage } = req.body || {};
    let targetStudent = providedStudent;

    if (studentId) {
      targetStudent = await findStudentById(studentId);
      if (!targetStudent) return res.status(404).json({ success: false, error: 'Student not found' });
    }

    if (!targetStudent) {
      targetStudent = {
        firstName: 'Student',
        familyName: 'Name',
        major: 'Informatics',
        section: 'mispce',
        assignedGroup: 'Grp A',
        campus: 'Fanar',
        status: 'New',
        email: 'student@example.com'
      };
    }

    const senderName = session.fullName ? `${session.fullName} (ULFS2 Delegation)` : 'ULFS2 Academic Delegation';
    const rendered = renderEmailTemplate({
      student: targetStudent,
      groupName,
      joinUrl,
      customMessage,
      senderName
    });

    return res.json({ success: true, ...rendered });
  } catch (err) {
    console.error('Error previewing email:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST send group invitation email(s) to student(s)
app.post('/api/email/send', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const callerRole = (session.role || 'deleg').toLowerCase();
  const callerSection = (session.section || (callerRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();

  const {
    studentId,
    studentIds,
    groupName,
    joinUrl,
    customMessage,
    markApproved = true,
    automatic = false,
    delayMs = 0,
    broadcastId = null
  } = req.body || {};
  const ids = Array.isArray(studentIds) ? studentIds.filter(Boolean) : (studentId ? [studentId] : []);

  if (!ids.length) {
    return res.status(400).json({ success: false, error: 'No student IDs specified for email invitation' });
  }

  if (!automatic && (!joinUrl || !String(joinUrl).trim())) {
    return res.status(400).json({ success: false, error: 'Group invitation URL is required' });
  }

  if (automatic && typeof syncEmailSettingsFromDb === 'function') {
    await syncEmailSettingsFromDb();
  }
  const savedEmailSettings = automatic ? getEffectiveSettings() : null;
  const configuredGroupLinks = savedEmailSettings?.groupLinks || {};
  const explicitJoinUrl = joinUrl ? String(joinUrl).trim() : '';
  const senderName = session.fullName ? `${session.fullName} (ULFS2 Delegation)` : 'ULFS2 Academic Delegation';

  const results = [];
  let sentCount = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    let student = null;
    try {
      student = await findStudentById(id);
      if (!student) {
        results.push({ id, success: false, error: 'Student record not found' });
        recordEmailLog({
          studentId: id,
          studentName: 'Unknown Student',
          status: 'failed',
          error: 'Student record not found',
          broadcastId
        });
        continue;
      }

      if (callerRole === 'deleg' || (callerRole === 'admin' && callerSection !== 'all')) {
        const studentSection = student.section || inferSectionFromMajor(student.major);
        if (studentSection !== callerSection) {
          results.push({ id, name: `${student.firstName} ${student.familyName}`, success: false, error: 'Student is outside your academic section' });
          recordEmailLog({
            studentId: id,
            studentName: `${student.firstName} ${student.familyName}`.trim(),
            status: 'failed',
            error: 'Student is outside your academic section',
            broadcastId
          });
          continue;
        }
      }

      const email = student.email ? String(student.email).trim() : '';
      if (!email || !isValidEmail(email)) {
        results.push({ id, name: `${student.firstName} ${student.familyName}`, success: false, error: 'Student does not have a valid email address' });
        recordEmailLog({
          studentId: id,
          studentName: `${student.firstName} ${student.familyName}`.trim(),
          email: '',
          major: student.major || '',
          section: student.section || '',
          assignedGroup: student.assignedGroup || '',
          campus: student.campus || '',
          status: 'skipped',
          error: 'Student does not have a valid email address',
          broadcastId
        });
        continue;
      }

      const assignedGroup = String(student.assignedGroup || '').trim();
      const campus = String(student.campus || '').trim().toLowerCase();
      const automaticGroupKey = assignedGroup || ((campus.includes('amchit') || campus.includes('amshit')) ? 'Amchit' : 'general');
      const effectiveJoinUrl = explicitJoinUrl
        || String(configuredGroupLinks[automaticGroupKey] || configuredGroupLinks.general || '').trim();

      if (!effectiveJoinUrl) {
        results.push({
          id,
          name: `${student.firstName} ${student.familyName}`,
          success: false,
          error: `No invitation link is configured for ${automaticGroupKey === 'general' ? 'the general group' : automaticGroupKey}`
        });
        recordEmailLog({
          studentId: id,
          studentName: `${student.firstName} ${student.familyName}`.trim(),
          email,
          major: student.major || '',
          section: student.section || '',
          assignedGroup,
          campus: student.campus || '',
          status: 'failed',
          error: `No invitation link is configured for ${automaticGroupKey === 'general' ? 'the general group' : automaticGroupKey}`,
          broadcastId
        });
        continue;
      }

      const studentGroup = groupName || (student.assignedGroup ? `ULFS2 ${student.major} (${student.assignedGroup})` : `ULFS2 ${student.major}`);
      const effectiveCustomMessage = customMessage !== undefined
        ? String(customMessage).trim()
        : String(savedEmailSettings?.defaultCustomNote || '').trim();

      const sendResult = await sendInviteEmail({
        to: email,
        student,
        groupName: studentGroup,
        joinUrl: effectiveJoinUrl,
        customMessage: effectiveCustomMessage,
        senderName
      });

      if (markApproved) {
        try {
          await setStudentApprovalState(id, true);
        } catch (approvalErr) {
          console.warn(`Could not update approval for student ${id}:`, approvalErr.message);
        }
      }

      try {
        await setStudentEmailSentState(id, true);
      } catch (emailSentErr) {
        console.warn(`Could not update emailSent state for student ${id}:`, emailSentErr.message);
      }

      sentCount++;
      results.push({
        id,
        name: `${student.firstName} ${student.familyName}`,
        email,
        success: true,
        groupKey: automaticGroupKey,
        previewUrl: sendResult.previewUrl,
        isSimulated: sendResult.isSimulated,
        emailSent: true
      });

      recordEmailLog({
        studentId: id,
        studentName: `${student.firstName} ${student.familyName}`.trim(),
        email,
        major: student.major || '',
        section: student.section || '',
        assignedGroup,
        campus: student.campus || '',
        groupKey: automaticGroupKey,
        joinUrl: effectiveJoinUrl,
        status: 'sent',
        messageId: sendResult.messageId,
        previewUrl: sendResult.previewUrl,
        isSimulated: sendResult.isSimulated,
        broadcastId
      });
    } catch (err) {
      const isRateLimit = isSmtpRateLimitError(err);
      console.error(`Error sending email to student ${id}:`, err.message);
      results.push({ id, success: false, error: err.message, isRateLimit });

      recordEmailLog({
        studentId: id,
        studentName: student ? `${student.firstName} ${student.familyName}`.trim() : 'Student',
        email: student?.email || '',
        major: student?.major || '',
        section: student?.section || '',
        assignedGroup: student?.assignedGroup || '',
        campus: student?.campus || '',
        status: 'failed',
        error: err.message,
        isRateLimit,
        broadcastId
      });

      if (isRateLimit && ids.length > 1) {
        console.warn(`Halting batch email send at student ${id} due to provider rate limit`);
        break;
      }
    }

    if (ids.length > 1 && delayMs > 0 && i < ids.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const firstPreviewUrl = results.find(r => r.previewUrl)?.previewUrl || null;
  const anySimulated = results.some(r => r.isSimulated);

  return res.json({
    success: sentCount > 0 || ids.length === 0,
    sentCount,
    totalCount: ids.length,
    results,
    previewUrl: firstPreviewUrl,
    simulated: anySimulated,
    message: sentCount === 1
      ? `Invitation email sent successfully to ${results[0]?.name || 'student'}.`
      : `${sentCount} of ${ids.length} invitation email${sentCount === 1 ? '' : 's'} sent successfully.`
  });
});

// GET eligible email recipients and count breakdown (Admin/Superadmin only)
app.get('/api/email/recipients', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const callerRole = (session.role || 'deleg').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Only administrators can inspect mass email recipients' });
  }

  try {
    let studentList = [];
    if (supabase) {
      const { data, error } = await supabase.from('students').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      studentList = (data || []).filter(r => !isSystemStudent(r)).map(mapStudent);
    } else {
      const { rows } = await pool.query(`
        SELECT note, kazaa, id, first_name AS "firstName", father_name AS "fatherName", family_name AS "familyName",
               origin, address, school, major, political_affiliation AS "politicalAffiliation",
               status, language, campus, phone, email, in_group AS "inGroup", left_group AS "leftGroup", created_at AS "createdAt"
        FROM students ORDER BY created_at DESC;
      `);
      studentList = rows.map(mapStudent);
    }

    const total = studentList.length;
    let withEmail = 0;
    let withoutEmail = 0;
    let uninvited = 0;
    let invited = 0;
    const bySection = { mispce: 0, csvt: 0, other: 0 };
    const byCampus = { fanar: 0, amchit: 0, other: 0 };

    const recipients = studentList.map(s => {
      const email = s.email ? String(s.email).trim() : '';
      const hasValidEmail = Boolean(email && email.includes('@'));
      const isInvited = Boolean(s.linkApproved || s.inClass);
      const sec = (s.section || inferSectionFromMajor(s.major) || 'other').toLowerCase();
      const camp = (s.campus || '').toLowerCase();

      if (hasValidEmail) withEmail++; else withoutEmail++;
      if (isInvited) invited++; else uninvited++;

      if (sec === 'mispce') bySection.mispce++;
      else if (sec === 'csvt') bySection.csvt++;
      else bySection.other++;

      if (camp.includes('am')) byCampus.amchit++;
      else if (camp.includes('fan')) byCampus.fanar++;
      else byCampus.other++;

      return {
        id: s.id,
        firstName: s.firstName || '',
        fatherName: s.fatherName || '',
        familyName: s.familyName || '',
        fullName: [s.firstName, s.fatherName, s.familyName].filter(Boolean).join(' ') || 'Student',
        email: hasValidEmail ? email : '',
        major: s.major || '',
        section: sec,
        assignedGroup: s.assignedGroup || '',
        campus: s.campus || '',
        status: s.status || '',
        linkApproved: isInvited,
        inClass: isInvited,
        inGroup: Boolean(s.inGroup),
        hasValidEmail
      };
    });

    return res.json({
      success: true,
      counts: {
        total,
        withEmail,
        withoutEmail,
        uninvited,
        invited,
        bySection,
        byCampus
      },
      recipients
    });
  } catch (err) {
    console.error('Error fetching email recipients:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET email broadcast and delivery logs (Admin/Superadmin only)
app.get('/api/email/logs', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const callerRole = (session.role || 'deleg').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Only administrators can view email delivery logs' });
  }

  const { limit, offset, status, search, broadcastId } = req.query;
  const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 200, 1000) : 200;
  const parsedOffset = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;

  const result = getEmailLogs({
    limit: parsedLimit,
    offset: parsedOffset,
    status: status ? String(status) : null,
    search: search ? String(search) : null,
    broadcastId: broadcastId ? String(broadcastId) : null
  });

  return res.json({
    success: true,
    logs: result.logs,
    total: result.total,
    stats: result.stats
  });
});

// DELETE clear email delivery logs (Admin/Superadmin only)
app.delete('/api/email/logs', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid', unauthenticated: true });

  const callerRole = (session.role || 'deleg').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Only administrators can clear email delivery logs' });
  }

  clearEmailLogs();
  return res.json({ success: true, message: 'Email delivery logs cleared successfully' });
});

// DELETE student
app.delete('/api/students/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    if (supabase) {
      const { data, error } = await supabase.from('students').delete().eq('id', id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Student not found' });
      return res.json({ success: true, message: 'Student deleted successfully' });
    }
    const { rowCount } = await pool.query('DELETE FROM students WHERE id = $1;', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    res.json({ success: true, message: 'Student deleted successfully' });
  } catch (err) {
    console.error('Error deleting student:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ensure any unhandled /api route returns JSON 404 instead of HTML
app.all(/^\/api(\/.*)?$/, (req, res) => {
  return res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.path}`
  });
});

// Global API error handler ensuring JSON responses
app.use('/api', (err, req, res, next) => {
  console.error('Unhandled API error:', err);
  const status = typeof err.status === 'number' ? err.status : 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// HTML page routing helpers
const servePage = page => (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  if (hasLocalFilesystem) return res.sendFile(path.join(__dirname, `${page}.html`));
  return res.redirect(302, `/${page}.html`);
};

app.get('/login', servePage('login'));
app.get('/form', servePage('form'));
app.get('/dashboard', servePage('dashboard'));
app.get('/users', servePage('users'));
app.get('/backup', servePage('backup'));
app.get(['/email-config', '/settings'], servePage('email-config'));

// Initialize DB and start listening
async function startServer() {
  try {
    await initDb();
    console.log('PostgreSQL database initialized successfully.');
  } catch (err) {
    console.warn('Could not initialize PostgreSQL on startup:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
