const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.NODE_ENV = 'test';

const { encryptValue, signSession } = require('../crypto');

let testStudent = {
  id: 'student-email-test-01',
  first_name: encryptValue('Nour', 'students.first_name'),
  father_name: encryptValue('Salim', 'students.father_name'),
  family_name: encryptValue('Haddad', 'students.family_name'),
  origin: encryptValue('Byblos', 'students.origin'),
  address: encryptValue('Voie 13', 'students.address'),
  school: encryptValue('College des Freres', 'students.school'),
  major: encryptValue('Informatics', 'students.major'),
  political_affiliation: '',
  status: encryptValue('New', 'students.status'),
  language: encryptValue('French', 'students.language'),
  campus: encryptValue('Fanar', 'students.campus'),
  phone: encryptValue('+961 3 999 888', 'students.phone'),
  email: encryptValue('nour.haddad@example.com', 'students.email'),
  in_group: false,
  left_group: false,
  in_class: false,
  email_sent: false,
  note: '',
  kazaa: '',
  created_at: new Date().toISOString()
};

// Mock database
require.cache[require.resolve('../db')] = {
  exports: {
    pool: {},
    supabaseRequested: true,
    initDb: async () => {},
    checkDbConnection: async () => ({}),
    supabase: {
      from: (tableName) => {
        assert.equal(tableName, 'students');
        return {
          select: () => ({
            eq: (field, value) => ({
              maybeSingle: async () => ({
                data: testStudent.id === value ? { ...testStudent } : null,
                error: null
              })
            }),
            order: () => ({
              range: async () => ({ data: [testStudent], error: null })
            })
          }),
          update: (payload) => ({
            eq: (field, value) => {
              if (testStudent.id === value) {
                if (payload.in_class !== undefined) {
                  testStudent.in_class = payload.in_class;
                }
                if (payload.email_sent !== undefined) {
                  testStudent.email_sent = payload.email_sent;
                }
                if (payload.note !== undefined) {
                  testStudent.note = payload.note;
                }
                return {
                  select: () => ({
                    maybeSingle: async () => ({ data: { ...testStudent }, error: null })
                  })
                };
              }
              return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
            }
          })
        };
      }
    }
  }
};

const app = require('../server');
const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

after(() => {
  server.close();
});

const adminToken = signSession({
  userId: 'test-admin-id',
  role: 'admin',
  section: 'all',
  username: 'admin',
  fullName: 'Test Administrator'
});

const delegToken = signSession({
  userId: 'test-deleg-id',
  role: 'deleg',
  section: 'mispce',
  username: 'deleg_mispce',
  fullName: 'MISPCE Delegate'
});

test('GET /api/email/status rejects unauthenticated requests with 401', async () => {
  const res = await fetch(`${baseUrl}/api/email/status`);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('GET /api/email/status returns mailer configuration with valid token', async () => {
  const res = await fetch(`${baseUrl}/api/email/status`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok('configured' in data);
  assert.ok('testMode' in data);
});

test('POST /api/email/preview renders invitation template for previewing', async () => {
  const res = await fetch(`${baseUrl}/api/email/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentId: testStudent.id,
      groupName: 'ULFS2 Informatics Grp A',
      joinUrl: 'https://chat.whatsapp.com/TESTGROUP123',
      customMessage: 'Classes begin next Monday in Room 102.'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.subject.includes('ULFS2 Informatics Grp A'));
  assert.ok(data.html.includes('Nour Salim Haddad'));
  assert.ok(data.html.includes('https://chat.whatsapp.com/TESTGROUP123'));
  assert.ok(data.html.includes('Classes begin next Monday in Room 102.'));
  assert.ok(data.text.includes('Nour Salim Haddad'));
});

test('POST /api/email/send rejects requests missing required fields', async () => {
  // Missing joinUrl
  const res1 = await fetch(`${baseUrl}/api/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentId: testStudent.id
    })
  });
  assert.equal(res1.status, 400);

  // Missing studentIds
  const res2 = await fetch(`${baseUrl}/api/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      joinUrl: 'https://chat.whatsapp.com/XYZ'
    })
  });
  assert.equal(res2.status, 400);
});

test('POST /api/email/send sends invitation and automatically marks linkApproved', async () => {
  testStudent.in_class = false;

  const res = await fetch(`${baseUrl}/api/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${delegToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentId: testStudent.id,
      joinUrl: 'https://chat.whatsapp.com/ULFS2INVITE',
      customMessage: 'Welcome to ULFS2!',
      markApproved: true
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.sentCount, 1);
  assert.equal(data.results[0].email, 'nour.haddad@example.com');
  assert.equal(data.results[0].success, true);

  // Verification that student link approval was updated
  assert.equal(testStudent.in_class, true);
});

test('GET /api/email/settings enforces admin authorization and masks password', async () => {
  // 401 unauthenticated
  const resUnauth = await fetch(`${baseUrl}/api/email/settings`);
  assert.equal(resUnauth.status, 401);

  // 403 delegate
  const resDeleg = await fetch(`${baseUrl}/api/email/settings`, {
    headers: { Authorization: `Bearer ${delegToken}` }
  });
  assert.equal(resDeleg.status, 403);

  // 200 admin
  const resAdmin = await fetch(`${baseUrl}/api/email/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resAdmin.status, 200);
  const data = await resAdmin.json();
  assert.equal(data.success, true);
  assert.ok(data.settings);
  assert.equal(data.settings.smtpPass, '', 'Password must never be returned in plaintext');
  assert.ok('groupLinks' in data.settings);
  assert.ok('configured' in data.settings);
});

test('POST /api/email/settings updates configuration and restricts delegates', async () => {
  // 403 delegate
  const resDeleg = await fetch(`${baseUrl}/api/email/settings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${delegToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      smtpHost: 'smtp.custom.org'
    })
  });
  assert.equal(resDeleg.status, 403);

  // 200 admin
  const resAdmin = await fetch(`${baseUrl}/api/email/settings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      smtpHost: 'smtp.mailgun.org',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'postmaster@custom.org',
      smtpPass: 'secret-token-1234',
      emailFrom: '"ULFS2 Office" <office@student-os.com>',
      groupLinks: {
        general: 'https://chat.whatsapp.com/GENERAL_INVITE',
        'Grp A': 'https://chat.whatsapp.com/GRP_A_INVITE',
        Amchit: 'https://chat.whatsapp.com/AMCHIT_INVITE'
      },
      defaultCustomNote: 'Welcome to semester 1!'
    })
  });

  assert.equal(resAdmin.status, 200);
  const data = await resAdmin.json();
  assert.equal(data.success, true);
  assert.equal(data.settings.smtpHost, 'smtp.mailgun.org');
  assert.equal(data.settings.groupLinks.general, 'https://chat.whatsapp.com/GENERAL_INVITE');
  assert.equal(data.settings.groupLinks['Grp A'], 'https://chat.whatsapp.com/GRP_A_INVITE');
  assert.equal(data.settings.groupLinks.Amchit, 'https://chat.whatsapp.com/AMCHIT_INVITE');
  assert.equal(data.settings.defaultCustomNote, 'Welcome to semester 1!');
  assert.equal(data.settings.smtpPassSet, true);
  assert.equal(data.settings.smtpPass, '');
});

test('POST /api/email/send automatically uses the saved group link', async () => {
  testStudent.in_class = false;

  const res = await fetch(`${baseUrl}/api/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${delegToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentId: testStudent.id,
      automatic: true,
      markApproved: true
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.sentCount, 1);
  assert.equal(data.results[0].groupKey, 'general');
  assert.equal(testStudent.in_class, true);
});

test('POST /api/email/test-connection verifies SMTP and rejects invalid inputs or delegates', async () => {
  // 403 delegate
  const resDeleg = await fetch(`${baseUrl}/api/email/test-connection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${delegToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ testEmail: 'test@example.com' })
  });
  assert.equal(resDeleg.status, 403);

  // 400 missing/invalid email
  const resMissing = await fetch(`${baseUrl}/api/email/test-connection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert.equal(resMissing.status, 400);

  // 200 successful test dispatch
  const resSuccess = await fetch(`${baseUrl}/api/email/test-connection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ testEmail: 'admin.verify@student-os.com' })
  });
  assert.equal(resSuccess.status, 200);
  const data = await resSuccess.json();
  assert.equal(data.success, true);
  assert.equal(data.recipient, 'admin.verify@student-os.com');
  assert.ok(data.messageId);
});

test('GET /api/email/recipients enforces admin authorization and returns recipient counts', async () => {
  // 403 for delegate
  const resDeleg = await fetch(`${baseUrl}/api/email/recipients`, {
    headers: { Authorization: `Bearer ${delegToken}` }
  });
  assert.equal(resDeleg.status, 403);

  // 200 for admin
  const resAdmin = await fetch(`${baseUrl}/api/email/recipients`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resAdmin.status, 200);
  const data = await resAdmin.json();
  assert.equal(data.success, true);
  assert.ok(data.counts);
  assert.ok('total' in data.counts);
  assert.ok('withEmail' in data.counts);
  assert.ok(Array.isArray(data.recipients));
});

test('GET and DELETE /api/email/logs manage dispatch logs with admin authorization', async () => {
  // 403 for delegate
  const resDeleg = await fetch(`${baseUrl}/api/email/logs`, {
    headers: { Authorization: `Bearer ${delegToken}` }
  });
  assert.equal(resDeleg.status, 403);

  // 200 for admin
  const resAdmin = await fetch(`${baseUrl}/api/email/logs`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resAdmin.status, 200);
  const data = await resAdmin.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.logs));
  assert.ok(data.stats);

  // DELETE logs
  const resDel = await fetch(`${baseUrl}/api/email/logs`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resDel.status, 200);
  const delData = await resDel.json();
  assert.equal(delData.success, true);
});

test('unhandled /api routes return JSON 404 instead of HTML <!DOCTYPE', async () => {
  const res = await fetch(`${baseUrl}/api/nonexistent-route-check`);
  assert.equal(res.status, 404);
  const contentType = res.headers.get('content-type') || '';
  assert.ok(contentType.includes('application/json'), `Expected application/json, got ${contentType}`);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.error, /API endpoint not found/i);
});

test('frontend scripts (email-config.js and script.js) avoid unsafe raw res.json() calls', () => {
  for (const file of ['email-config.js', 'script.js']) {
    const code = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    // Ensure no raw res.json() or response.json() calls exist
    const rawMatches = code.match(/\b(?:res|response)\.json\s*\(/g);
    assert.equal(rawMatches, null, `Found raw response.json() call in ${file}`);
  }
});

test('PATCH /api/students/:id/email-sent sets emailSent status and rejects unauthenticated requests', async () => {
  // Unauthenticated -> 401
  const unauthRes = await fetch(`${baseUrl}/api/students/${testStudent.id}/email-sent`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailSent: true })
  });
  assert.equal(unauthRes.status, 401);

  // Valid admin request -> 200 and emailSent: true
  const patchRes = await fetch(`${baseUrl}/api/students/${testStudent.id}/email-sent`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ emailSent: true })
  });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.success, true);
  assert.equal(patchData.emailSent, true);
  assert.equal(testStudent.email_sent, true);

  // Can unmark emailSent -> false
  const unmarkRes = await fetch(`${baseUrl}/api/students/${testStudent.id}/email-sent`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ emailSent: false })
  });
  assert.equal(unmarkRes.status, 200);
  const unmarkData = await unmarkRes.json();
  assert.equal(unmarkData.success, true);
  assert.equal(unmarkData.emailSent, false);
  assert.equal(testStudent.email_sent, false);

  // Non-existent student -> 404
  const notFoundRes = await fetch(`${baseUrl}/api/students/non-existent-student/email-sent`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ emailSent: true })
  });
  assert.equal(notFoundRes.status, 404);
});

test('POST /api/email/send automatically marks emailSent: true on recipient student', async () => {
  testStudent.email_sent = false;
  testStudent.in_class = false;

  const res = await fetch(`${baseUrl}/api/email/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      studentId: testStudent.id,
      groupName: 'ULFS2 Informatics Grp A',
      joinUrl: 'https://chat.whatsapp.com/TESTEMAIL123'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.results[0].emailSent, true);
  assert.equal(testStudent.email_sent, true);
});


