const API_BASE = window.location.protocol === 'file:'
  ? 'http://localhost:3000/api'
  : '/api';

// Shared light/dark appearance
const savedTheme = localStorage.getItem('student_os_theme');
const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.documentElement.dataset.theme = savedTheme || preferredTheme;

function setupThemeToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'themeToggle';
  button.className = 'theme-toggle';

  const updateButton = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.innerHTML = `<span aria-hidden="true">${dark ? '☀' : '☾'}</span><b>${dark ? 'Light' : 'Dark'}</b>`;
    button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
  };

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('student_os_theme', next);
    updateButton();
  });

  updateButton();
  const headerRight = document.querySelector('.header-right');
  if (headerRight) headerRight.appendChild(button);
  else document.body.appendChild(button);
}

async function parseApiResponse(response) {
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    const detail = body.trim().slice(0, 160) || `HTTP ${response.status}`;
    throw new Error(`API returned ${response.status}: ${detail}`);
  }
  if (!response.ok && !data.error) {
    data.error = `Request failed with HTTP ${response.status}`;
  }
  return data;
}

const form = document.querySelector('#studentForm');
const loginForm = document.querySelector('#loginForm');
const userForm = document.querySelector('#userForm');
const signupForm = document.querySelector('#signupForm');
const pendingUsers = document.querySelector('#pendingUsers');
const allUsersList = document.querySelector('#allUsersList');
const recordsGrid = document.querySelector('#recordsGrid');
const emptyState = document.querySelector('#emptyState');
const recordCount = document.querySelector('#recordCount');
const searchInput = document.querySelector('#searchInput');
const statusFilter = document.querySelector('#statusFilter');
const campusFilter = document.querySelector('#campusFilter');
const languageFilter = document.querySelector('#languageFilter');
const groupFilter = document.querySelector('#groupFilter');
const clearFilters = document.querySelector('#clearFilters');
const toast = document.querySelector('#toast');
const dbStatusPill = document.querySelector('#dbStatusPill');
const dbStatusText = document.querySelector('#dbStatusText');
const logoutBtn = document.querySelector('#logoutBtn');
const userNameDisplay = document.querySelector('#userNameDisplay');
const backupStatus = document.querySelector('#backupStatus');

let students = [];
let editingId = null;
let systemUsers = [];

const escapeHtml = (value = '') => String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));

// Authentication Protection
function checkAuth() {
  const currentPage = document.body.dataset.page;
  const userJson = localStorage.getItem('hub_user');

  if (currentPage === 'login') {
    if (userJson) {
      window.location.replace('dashboard.html');
      return false;
    }
    return true;
  }

  if (currentPage === 'signup') return true;

  if (!userJson) {
    window.location.replace('login.html');
    return false;
  }

  try {
    const user = JSON.parse(userJson);
    if (userNameDisplay) {
      userNameDisplay.textContent = user.fullName || user.username || 'Admin';
    }
  } catch (err) {
    localStorage.removeItem('hub_user');
    localStorage.removeItem('hub_token');
    window.location.replace('login.html');
    return false;
  }

  return true;
}

// Logout handler
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('hub_user');
    showToast('Logged out', 'You have been signed out successfully.');
    setTimeout(() => {
      window.location.replace('login.html');
    }, 800);
  });
}

// Login Form Submit handler
if (loginForm) {
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const usernameInput = loginForm.querySelector('#username');
    const passwordInput = loginForm.querySelector('#password');
    const loginError = document.querySelector('#loginError');
    const loginSubmitBtn = document.querySelector('#loginSubmitBtn');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
      if (loginError) loginError.textContent = 'Please enter both username and password.';
      return;
    }

    if (loginSubmitBtn) loginSubmitBtn.disabled = true;
    if (loginError) loginError.textContent = '';

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await parseApiResponse(res);

      if (json.success) {
        localStorage.setItem('hub_user', JSON.stringify(json.user));
        localStorage.setItem('hub_token', json.token);
        showToast('Login Successful', `Welcome back, ${json.user.fullName || json.user.username}!`);
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 1000);
      } else {
        if (loginError) loginError.textContent = json.error || 'Invalid username or password.';
        if (loginSubmitBtn) loginSubmitBtn.disabled = false;
      }
    } catch (err) {
      if (loginError) loginError.textContent = `Server error: ${err.message}`;
      if (loginSubmitBtn) loginSubmitBtn.disabled = false;
    }
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#signupMessage');
    const button = document.querySelector('#signupSubmitBtn');
    const values = Object.fromEntries(new FormData(signupForm).entries());
    if (values.password !== values.confirmPassword) {
      message.textContent = 'The passwords do not match.';
      return;
    }
    button.disabled = true;
    message.textContent = '';
    delete values.confirmPassword;
    try {
      const response = await fetch(`${API_BASE}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const json = await parseApiResponse(response);
      if (!json.success) throw new Error(json.error || 'Could not submit request');
      signupForm.reset();
      message.classList.add('success-message');
      message.textContent = 'Request sent. You can sign in after an administrator approves your account.';
    } catch (error) {
      message.classList.remove('success-message');
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

async function loadPendingUsers() {
  if (!pendingUsers) return;
  const count = document.querySelector('#pendingCount');
  try {
    const response = await fetch(`${API_BASE}/users/pending`, { headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not load requests');
    count.textContent = `${json.data.length} pending`;
    pendingUsers.innerHTML = json.data.length ? json.data.map(user => `
      <article class="pending-user">
        <div><strong>${escapeHtml(user.fullName)}</strong><span>@${escapeHtml(user.username)}</span><small>Requested ${new Date(user.createdAt).toLocaleDateString()}</small></div>
        <div class="pending-actions"><button type="button" class="approve-user" onclick="reviewUser('${user.id}', true)">Approve</button><button type="button" class="reject-user" onclick="reviewUser('${user.id}', false)">Reject</button></div>
      </article>`).join('') : '<p class="no-pending">No pending account requests.</p>';
  } catch (error) {
    count.textContent = 'Unavailable';
    pendingUsers.innerHTML = `<p class="no-pending error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function reviewUser(id, approved) {
  try {
    const response = await fetch(`${API_BASE}/users/${id}/approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` },
      body: JSON.stringify({ approved })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update request');
    showToast(approved ? 'Account approved' : 'Request rejected', approved ? 'The user can now sign in.' : 'The request was removed.');
    loadPendingUsers();
    loadAllUsers();
  } catch (error) {
    await showPopup({ title: 'Could not review account', message: error.message, danger: true });
  }
}

async function loadAllUsers() {
  if (!allUsersList) return;
  const count = document.querySelector('#allUsersCount');
  try {
    const response = await fetch(`${API_BASE}/users/all`, { headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not load users');
    count.textContent = `${json.data.length} user${json.data.length === 1 ? '' : 's'}`;
    systemUsers = json.data;
    allUsersList.innerHTML = json.data.length ? json.data.map(user => `
      <article class="system-user">
        <div class="system-user-avatar">${escapeHtml(`${user.fullName?.[0] || user.username?.[0] || 'U'}`.toUpperCase())}</div>
        <div class="system-user-identity"><strong>${escapeHtml(user.fullName || user.username)}</strong><span>@${escapeHtml(user.username)}</span></div>
        <span class="user-role">${escapeHtml(user.role)}</span>
        <span class="user-status ${user.approved ? 'approved' : 'pending'}">${user.approved ? 'Approved' : 'Pending'}</span>
        <small>${new Date(user.createdAt).toLocaleDateString()}</small>
        <div class="system-user-actions"><button type="button" class="edit-user" onclick="openUserEditor('${user.id}')">Edit</button><button type="button" class="delete-user" onclick="deleteSystemUser('${user.id}')">Delete</button></div>
      </article>`).join('') : '<p class="no-pending">No user accounts found.</p>';
  } catch (error) {
    count.textContent = 'Unavailable';
    allUsersList.innerHTML = `<p class="no-pending error-text">${escapeHtml(error.message)}</p>`;
  }
}

function openUserEditor(id) {
  const user = systemUsers.find(item => item.id === id);
  const overlay = document.querySelector('#userEditorOverlay');
  const editor = document.querySelector('#userEditorForm');
  if (!user || !overlay || !editor) return;
  editor.elements.id.value = user.id;
  editor.elements.fullName.value = user.fullName || '';
  editor.elements.username.value = user.username || '';
  editor.elements.role.value = user.role;
  editor.elements.approved.value = String(user.approved);
  editor.elements.password.value = '';
  document.querySelector('#userEditorMessage').textContent = '';
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  editor.elements.fullName.focus();
}

function closeUserEditor() {
  const overlay = document.querySelector('#userEditorOverlay');
  if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
}

const userEditorForm = document.querySelector('#userEditorForm');
if (userEditorForm) {
  userEditorForm.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(userEditorForm).entries());
    const id = values.id;
    values.approved = values.approved === 'true';
    delete values.id;
    if (!values.password) delete values.password;
    const message = document.querySelector('#userEditorMessage');
    const submit = userEditorForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch(`${API_BASE}/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }, body: JSON.stringify(values) });
      const json = await parseApiResponse(response);
      if (!json.success) throw new Error(json.error || 'Could not update user');
      closeUserEditor();
      showToast('User updated', 'The account changes were saved.');
      loadAllUsers();
      loadPendingUsers();
    } catch (error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  document.querySelector('#userEditorClose').addEventListener('click', closeUserEditor);
  document.querySelector('#userEditorCancel').addEventListener('click', closeUserEditor);
  document.querySelector('#userEditorOverlay').addEventListener('click', event => { if (event.target.id === 'userEditorOverlay') closeUserEditor(); });
}

async function deleteSystemUser(id) {
  const user = systemUsers.find(item => item.id === id);
  const name = user?.fullName || user?.username || 'This user';
  const confirmed = await showPopup({ title: 'Delete user account?', message: `${name} will permanently lose access to student-os.com.`, confirmLabel: 'Delete user', showCancel: true, danger: true });
  if (!confirmed) return;
  try {
    const response = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not delete user');
    showToast('User deleted', 'The account was permanently removed.');
    loadAllUsers();
    loadPendingUsers();
  } catch (error) { await showPopup({ title: 'Could not delete user', message: error.message, danger: true }); }
}

async function loadBackupStatus() {
  if (!backupStatus) return;
  const message = document.querySelector('#backupMessage');
  try {
    const response = await fetch(`${API_BASE}/backup/status`, { headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error);
    backupStatus.textContent = json.connected ? 'Google Drive connected' : (json.configured ? 'Ready to connect' : 'Google OAuth setup required');
    backupStatus.classList.toggle('connected', json.connected);
    document.querySelector('#retentionDays').value = String(json.retentionDays);
    document.querySelector('#backupEnabled').value = String(json.enabled);
    document.querySelector('#lastBackup').textContent = json.lastBackupAt ? `${new Date(json.lastBackupAt).toLocaleString()} — ${json.lastBackupName}` : 'Never';
    document.querySelector('#runBackupNow').disabled = !json.connected;
    if (json.lastError) message.textContent = json.lastError;
  } catch (error) { backupStatus.textContent = 'Unavailable'; message.textContent = error.message; }
}

const connectDrive = document.querySelector('#connectDrive');
if (connectDrive) connectDrive.addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_BASE}/backup/connect`, { headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error);
    window.location.href = json.url;
  } catch (error) { document.querySelector('#backupMessage').textContent = error.message; }
});

const runBackupNow = document.querySelector('#runBackupNow');
if (runBackupNow) runBackupNow.addEventListener('click', async () => {
  const backupCard = document.querySelector('#backupCard');
  const backupProgress = document.querySelector('#backupProgress');
  const backupLabel = document.querySelector('#runBackupLabel');
  const backupMessage = document.querySelector('#backupMessage');
  runBackupNow.disabled = true;
  runBackupNow.classList.add('is-loading');
  if (backupCard) backupCard.setAttribute('aria-busy', 'true');
  if (backupProgress) backupProgress.hidden = false;
  if (backupLabel) backupLabel.textContent = 'Backing up…';
  if (backupMessage) backupMessage.textContent = '';
  try {
    const response = await fetch(`${API_BASE}/backup/run`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` } });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error);
    showToast('Backup complete', `${json.data.name} was saved to Google Drive.`);
    await loadBackupStatus();
  } catch (error) {
    if (backupMessage) backupMessage.textContent = error.message;
  } finally {
    runBackupNow.classList.remove('is-loading');
    runBackupNow.disabled = false;
    if (backupCard) backupCard.removeAttribute('aria-busy');
    if (backupProgress) backupProgress.hidden = true;
    if (backupLabel) backupLabel.textContent = 'Back up now';
  }
});

const saveBackupSettings = document.querySelector('#saveBackupSettings');
if (saveBackupSettings) saveBackupSettings.addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_BASE}/backup/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }, body: JSON.stringify({ retentionDays: Number(document.querySelector('#retentionDays').value), enabled: document.querySelector('#backupEnabled').value === 'true' }) });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error);
    showToast('Settings saved', 'Your daily backup preferences were updated.');
  } catch (error) { document.querySelector('#backupMessage').textContent = error.message; }
});

if (userForm) {
  userForm.addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#userFormMessage');
    const submitButton = document.querySelector('#userSubmitBtn');
    const values = Object.fromEntries(new FormData(userForm).entries());
    userForm.querySelectorAll('[required]').forEach(input => input.classList.toggle('invalid', !input.validity.valid));
    const invalid = userForm.querySelector(':invalid');
    if (invalid) {
      message.textContent = 'Please complete all required fields correctly.';
      invalid.focus();
      return;
    }
    if (values.password !== values.confirmPassword) {
      message.textContent = 'The passwords do not match.';
      userForm.elements.confirmPassword.classList.add('invalid');
      userForm.elements.confirmPassword.focus();
      return;
    }
    submitButton.disabled = true;
    message.textContent = '';
    delete values.confirmPassword;
    try {
      const response = await fetch(`${API_BASE}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const json = await parseApiResponse(response);
      if (!json.success) throw new Error(json.error || 'Could not create user');
      userForm.reset();
      showToast('User created', `${values.fullName} can now sign in to student-os.com.`);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
  userForm.addEventListener('input', event => {
    event.target.classList.remove('invalid');
    const message = document.querySelector('#userFormMessage');
    if (message) message.textContent = '';
  });
}

// Check student-os.com system connection status
async function checkDbConnection() {
  if (!dbStatusPill || !dbStatusText) return;
  try {
    const res = await fetch(`${API_BASE}/db-status`);
    const data = await parseApiResponse(res);
    if (data.connected) {
      dbStatusPill.classList.remove('disconnected');
      dbStatusPill.classList.add('connected');
      dbStatusText.textContent = 'student-os.com Online';
      dbStatusPill.title = `Secure system online (${data.count} records stored)`;
    } else {
      dbStatusPill.classList.remove('connected');
      dbStatusPill.classList.add('disconnected');
      dbStatusText.textContent = `System Offline`;
      dbStatusPill.title = `System error: ${data.message || 'Could not connect to the system'}`;
    }
  } catch (err) {
    dbStatusPill.classList.remove('connected');
    dbStatusPill.classList.add('disconnected');
    dbStatusText.textContent = `System Offline`;
    dbStatusPill.title = `Connection error: ${err.message}`;
  }
}

// Fetch all students from backend
async function fetchStudents() {
  try {
    const res = await fetch(`${API_BASE}/students`);
    const json = await parseApiResponse(res);
    if (json.success) {
      students = json.data || [];
      renderStudents(searchInput ? searchInput.value : '');
    } else {
      console.error('Failed to fetch students:', json.error);
    }
  } catch (err) {
    console.error('Error connecting to backend:', err);
  }
}

// Render student grid and stats (for dashboard)
function renderStudents(query = '') {
  if (!recordsGrid) return;
  const needle = query.trim().toLowerCase();
  const filtered = students.filter(student => {
    const matchesSearch = Object.values(student).some(value => String(value).toLowerCase().includes(needle));
    const matchesStatus = !statusFilter?.value || student.status === statusFilter.value;
    const matchesCampus = !campusFilter?.value || student.campus === campusFilter.value;
    const matchesLanguage = !languageFilter?.value || student.language === languageFilter.value;
    const matchesGroup = !groupFilter?.value
      || (groupFilter.value === 'in' ? student.inGroup : !student.inGroup);
    return matchesSearch && matchesStatus && matchesCampus && matchesLanguage && matchesGroup;
  });

  if (recordCount) recordCount.textContent = students.length;
  updateStats();
  const directorySummary = document.querySelector('#directorySummary');
  if (directorySummary) {
    const filtering = needle || statusFilter?.value || campusFilter?.value || languageFilter?.value || groupFilter?.value;
    directorySummary.textContent = filtering
      ? `${filtered.length} of ${students.length} students`
      : `${students.length} student${students.length === 1 ? '' : 's'}`;
  }

  if (emptyState) {
    emptyState.style.display = filtered.length ? 'none' : 'block';
  }

  recordsGrid.innerHTML = filtered.map(student => {
    const fullName = `${student.firstName} ${student.fatherName} ${student.familyName}`;
    const initials = `${student.firstName?.[0] || ''}${student.familyName?.[0] || ''}`.toUpperCase();
    return `
      <article class="student-card">
        <span class="tag">${escapeHtml(student.status)}</span>
        <div class="student-top">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div>
            <h3>${escapeHtml(fullName)}</h3>
            <p>${escapeHtml(student.major)}</p>
          </div>
        </div>
        <div class="student-details">
          <div class="detail"><small>Major</small><span title="${escapeHtml(student.major)}">${escapeHtml(student.major)}</span></div>
          <div class="detail"><small>School</small><span title="${escapeHtml(student.school)}">${escapeHtml(student.school)}</span></div>
          <div class="detail"><small>Campus</small><span>${escapeHtml(student.campus)}</span></div>
          <div class="detail"><small>Phone</small><span>${escapeHtml(student.phone)}</span></div>
          <div class="detail"><small>Language</small><span>${escapeHtml(student.language)}</span></div>
          <div class="detail"><small>Email</small><span title="${escapeHtml(student.email)}">${escapeHtml(student.email)}</span></div>
          <div class="detail"><small>Origin</small><span>${escapeHtml(student.origin || 'N/A')}</span></div>
          <div class="detail political-detail">
            <small>Political affiliation</small>
            ${student.politicalAffiliation ? `
              <span class="political-value" aria-live="polite">••••••••</span>
              <button type="button" class="reveal-affiliation" data-student-id="${escapeHtml(student.id)}" aria-expanded="false">Show affiliation</button>
            ` : '<span>Not provided</span>'}
          </div>
        </div>
        <div class="card-actions">
          <button type="button"
            class="btn-action group-toggle ${student.inGroup ? 'is-in-group' : ''}"
            onclick="toggleGroupMembership('${student.id}', ${!student.inGroup}, this)"
            aria-pressed="${student.inGroup ? 'true' : 'false'}"
            ${student.leftGroup ? 'disabled title="This student left the group"' : ''}>
            ${student.leftGroup ? 'In group (disabled)' : (student.inGroup ? '✓ In group' : '+ Add to group')}
          </button>
          ${student.inGroup && !student.leftGroup ? `
            <button type="button" class="btn-action left-group"
              onclick="markStudentLeftGroup('${student.id}', this)">Left group</button>
          ` : student.leftGroup ? '<span class="left-group-status">Left group</span>' : ''}
          <a class="btn-action edit" href="form.html?edit=${student.id}">Edit record</a>
          <button type="button" class="btn-action delete" onclick="deleteStudentRecord('${student.id}')">Delete</button>
        </div>
      </article>
    `;
  }).join('');
}

function togglePoliticalAffiliation(id, button) {
  const student = students.find(item => String(item.id) === String(id));
  const value = button?.closest('.political-detail')?.querySelector('.political-value');
  if (!student || !value || !button) return;

  const revealing = button.getAttribute('aria-expanded') !== 'true';
  value.textContent = revealing ? (student.politicalAffiliation || 'Not provided') : '••••••••';
  value.title = revealing ? (student.politicalAffiliation || '') : '';
  button.textContent = revealing ? 'Hide affiliation' : 'Show affiliation';
  button.setAttribute('aria-expanded', String(revealing));
}

document.addEventListener('click', event => {
  const revealButton = event.target.closest('.reveal-affiliation');
  if (revealButton) togglePoliticalAffiliation(revealButton.dataset.studentId, revealButton);
});

const politicalFieldToggle = document.querySelector('#politicalFieldToggle');
const politicalField = document.querySelector('#politicalField');
if (politicalFieldToggle && politicalField) {
  politicalFieldToggle.addEventListener('click', () => {
    const showing = politicalField.hidden;
    politicalField.hidden = !showing;
    politicalFieldToggle.setAttribute('aria-expanded', String(showing));
    politicalFieldToggle.textContent = showing
      ? 'Hide political affiliation field'
      : 'Show political affiliation field';
    if (showing) politicalField.querySelector('select')?.focus();
  });
}

const politicalStatsToggle = document.querySelector('#politicalStatsToggle');
const politicalStatsPanel = document.querySelector('#politicalStatsPanel');
if (politicalStatsToggle && politicalStatsPanel) {
  politicalStatsToggle.addEventListener('click', () => {
    const showing = politicalStatsPanel.hidden;
    politicalStatsPanel.hidden = !showing;
    politicalStatsToggle.setAttribute('aria-expanded', String(showing));
    politicalStatsToggle.textContent = showing ? 'Hide political statistics' : 'Show political statistics';
  });
}

// Update dashboard metrics and charts
function updateStats() {
  const total = students.length;
  const count = (key, value) => students.filter(s => s[key] === value).length;
  const newCount = count('status', 'New');
  const returningCount = count('status', 'Mu3id');
  const groupCount = students.filter(student => student.inGroup).length;
  const fanar = count('campus', 'Fanar');
  const amshit = count('campus', 'Amshit');
  const french = count('language', 'French');
  const english = count('language', 'English');
  const percent = value => total ? Math.round(value / total * 100) : 0;
  const schools = new Set(students.map(s => (s.school || '').trim().toLowerCase()).filter(Boolean)).size;

  const setText = (id, value) => {
    const el = document.querySelector(id);
    if (el) el.textContent = value;
  };

  setText('#totalStudents', total);
  setText('#newStudents', newCount);
  setText('#returningStudents', returningCount);
  setText('#schoolCount', schools);
  setText('#groupStudents', groupCount);
  setText('#groupPercentage', `${percent(groupCount)}% of total`);
  setText('#newPercentage', `${percent(newCount)}% of total`);
  setText('#returningPercentage', `${percent(returningCount)}% of total`);
  setText('#fanarCount', fanar);
  setText('#amshitCount', amshit);
  setText('#donutTotal', total);
  setText('#frenchPercent', `${percent(french)}%`);
  setText('#englishPercent', `${percent(english)}%`);
  setText('#frenchCount', `${french} student${french === 1 ? '' : 's'}`);
  setText('#englishCount', `${english} student${english === 1 ? '' : 's'}`);
  setText('#directorySummary', `${total} student${total === 1 ? '' : 's'}`);

  const fanarBar = document.querySelector('#fanarBar');
  const amshitBar = document.querySelector('#amshitBar');
  const frenchBar = document.querySelector('#frenchBar');
  const englishBar = document.querySelector('#englishBar');
  const campusDonut = document.querySelector('#campusDonut');

  if (fanarBar) fanarBar.style.width = `${percent(fanar)}%`;
  if (amshitBar) amshitBar.style.width = `${percent(amshit)}%`;
  if (frenchBar) frenchBar.style.width = `${percent(french)}%`;
  if (englishBar) englishBar.style.width = `${percent(english)}%`;
  if (campusDonut) campusDonut.style.setProperty('--fanar', `${percent(fanar)}%`);

  document.querySelectorAll('.major-stat').forEach(card => {
    const major = card.dataset.major;
    const majorCount = students.filter(student => (student.major || '').toLowerCase() === major.toLowerCase()).length;
    const majorPercent = percent(majorCount);
    card.querySelector('b').textContent = majorCount;
    card.querySelector('i').style.width = `${majorPercent}%`;
    card.querySelector('small').textContent = `${majorPercent}% of students`;
  });

  const politicalStatsGrid = document.querySelector('#politicalStatsGrid');
  if (politicalStatsGrid) {
    const affiliationCounts = students.reduce((counts, student) => {
      const affiliation = (student.politicalAffiliation || '').trim() || 'Not provided';
      counts[affiliation] = (counts[affiliation] || 0) + 1;
      return counts;
    }, {});
    const rows = Object.entries(affiliationCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    politicalStatsGrid.innerHTML = rows.length ? rows.map(([affiliation, affiliationCount]) => {
      const affiliationPercent = percent(affiliationCount);
      return `
        <div class="political-stat-row">
          <div class="political-stat-copy"><span>${escapeHtml(affiliation)}</span><b>${affiliationCount} <small>(${affiliationPercent}%)</small></b></div>
          <div class="political-stat-progress" aria-hidden="true"><i style="width:${affiliationPercent}%"></i></div>
        </div>`;
    }).join('') : '<p class="political-stats-empty">No student records are available.</p>';
  }
}

async function toggleGroupMembership(id, inGroup, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inGroup })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update group membership');

    const student = students.find(item => item.id === id);
    if (student) student.inGroup = inGroup;
    renderStudents(searchInput ? searchInput.value : '');
    showToast(
      inGroup ? 'Added to group' : 'Removed from group',
      inGroup ? 'The student is now in the group.' : 'The student is no longer in the group.'
    );
  } catch (err) {
    if (button) button.disabled = false;
    await showPopup({ title: 'Could not update group', message: err.message, danger: true });
  }
}

async function markStudentLeftGroup(id, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inGroup: false, leftGroup: true })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not mark the student as having left');

    const student = students.find(item => item.id === id);
    if (student) {
      student.inGroup = false;
      student.leftGroup = true;
    }
    renderStudents(searchInput ? searchInput.value : '');
    showToast('Student left the group', 'The In group option is now disabled for this student.');
  } catch (err) {
    if (button) button.disabled = false;
    await showPopup({ title: 'Could not update group', message: err.message, danger: true });
  }
}

// Show Toast notification
function showToast(title, message) {
  if (!toast) return;
  const toastTitle = document.querySelector('#toastTitle');
  const toastMsg = document.querySelector('#toastMsg');
  if (toastTitle) toastTitle.textContent = title;
  if (toastMsg) toastMsg.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3500);
}

function showPopup({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', showCancel = false, danger = false }) {
  let overlay = document.querySelector('#popupOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'popupOverlay';
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
      <section class="popup-dialog" role="dialog" aria-modal="true" aria-labelledby="popupTitle" aria-describedby="popupMessage">
        <div class="popup-icon" id="popupIcon">!</div>
        <h2 id="popupTitle"></h2>
        <p id="popupMessage"></p>
        <div class="popup-actions">
          <button type="button" class="popup-cancel" id="popupCancel"></button>
          <button type="button" class="popup-confirm" id="popupConfirm"></button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
  }

  const dialog = overlay.querySelector('.popup-dialog');
  const cancelButton = overlay.querySelector('#popupCancel');
  const confirmButton = overlay.querySelector('#popupConfirm');
  overlay.querySelector('#popupTitle').textContent = title;
  overlay.querySelector('#popupMessage').textContent = message;
  overlay.querySelector('#popupIcon').textContent = danger ? '!' : 'i';
  cancelButton.textContent = cancelLabel;
  cancelButton.hidden = !showCancel;
  confirmButton.textContent = confirmLabel;
  confirmButton.classList.toggle('danger', danger);
  dialog.classList.toggle('is-danger', danger);
  overlay.classList.add('show');

  return new Promise(resolve => {
    const close = result => {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(false);
    };
    confirmButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    overlay.onclick = event => { if (event.target === overlay) close(false); };
    document.addEventListener('keydown', onKeydown);
    requestAnimationFrame(() => confirmButton.focus());
  });
}

// Delete student record from backend
async function deleteStudentRecord(id) {
  const confirmed = await showPopup({
    title: 'Delete student record?',
    message: 'This student will be permanently removed. This action cannot be undone.',
    confirmLabel: 'Delete record',
    showCancel: true,
    danger: true
  });
  if (!confirmed) {
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/students/${id}`, { method: 'DELETE' });
    const json = await parseApiResponse(res);
    if (json.success) {
      showToast('Record deleted', 'The student record was removed.');
      fetchStudents();
      checkDbConnection();
    } else {
      await showPopup({ title: 'Could not delete record', message: json.error || 'Please try again.', danger: true });
    }
  } catch (err) {
    await showPopup({ title: 'Something went wrong', message: err.message, danger: true });
  }
}

// Form logic (Add / Edit Student)
if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [...form.querySelectorAll('[required]')];
    required.forEach(input => input.classList.toggle('invalid', !input.validity.valid));
    const firstInvalid = required.find(input => !input.validity.valid);
    if (firstInvalid) {
      const msg = document.querySelector('#formMessage');
      if (msg) msg.textContent = 'Please complete all required fields correctly.';
      firstInvalid.focus();
      return;
    }

    const studentData = Object.fromEntries(new FormData(form).entries());
    const submitBtn = document.querySelector('#submitBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      let res, json;
      if (editingId) {
        res = await fetch(`${API_BASE}/students/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentData),
        });
      } else {
        res = await fetch(`${API_BASE}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentData),
        });
      }

      json = await parseApiResponse(res);

      if (json.success) {
        showToast(
          editingId ? 'Student record updated' : 'Student saved',
          'The student profile and credentials were saved successfully.'
        );
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 1200);
      } else {
        const msg = document.querySelector('#formMessage');
        if (msg) msg.textContent = `Error: ${json.error || 'Failed to save to database'}`;
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch (err) {
      const msg = document.querySelector('#formMessage');
      if (msg) msg.textContent = `Server connection error: ${err.message}`;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  form.addEventListener('input', event => {
    event.target.classList.remove('invalid');
    const msg = document.querySelector('#formMessage');
    if (msg) msg.textContent = '';
  });
}

// Handle Form Edit Mode pre-fill if ?edit=ID is in URL
async function initFormEditMode() {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit');
  if (!editId || !form) return;

  editingId = editId;
  const formTitle = document.querySelector('#formTitle');
  const pageHeading = document.querySelector('#pageHeading');
  const submitText = document.querySelector('#submitText');
  const cancelEdit = document.querySelector('#cancelEdit');

  if (formTitle) formTitle.textContent = 'Edit student profile';
  if (pageHeading) pageHeading.innerHTML = 'Edit <em>Student Record</em>';
  if (submitText) submitText.textContent = 'Update Student';
  if (cancelEdit) cancelEdit.classList.remove('hidden');

  try {
    const res = await fetch(`${API_BASE}/students/${editId}`);
    const json = await parseApiResponse(res);
    if (json.success && json.data) {
      const student = json.data;
      Object.entries(student).forEach(([key, value]) => {
        const input = form.querySelector(`[name="${key}"][value="${CSS.escape(value || '')}"]`) || form.querySelector(`[name="${key}"]`);
        if (input) {
          if (input.type === 'radio') {
            input.checked = true;
          } else {
            input.value = value || '';
          }
        }
      });
    }
  } catch (err) {
    console.error('Failed to load student for editing:', err);
  }
}

// Search input listener
if (searchInput) {
  searchInput.addEventListener('input', () => renderStudents(searchInput.value));
}

[statusFilter, campusFilter, languageFilter, groupFilter].forEach(filter => {
  if (filter) filter.addEventListener('change', () => renderStudents(searchInput?.value || ''));
});

if (clearFilters) {
  clearFilters.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    [statusFilter, campusFilter, languageFilter, groupFilter].forEach(filter => {
      if (filter) filter.value = '';
    });
    renderStudents('');
  });
}

// Export CSV button listener
const exportBtn = document.querySelector('#exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (!students.length) return showToast('Nothing to export', 'No student records available.');
    const columns = ['firstName','fatherName','familyName','school','address','origin','phone','major','politicalAffiliation','status','language','campus','email','inGroup'];
    const csv = [columns.join(','), ...students.map(s => columns.map(key => `"${String(s[key] || '').replaceAll('"','""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    link.download = 'student-os-records.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// Page Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();
  if (!checkAuth()) return;
  if (document.body.dataset.page === 'login') return;
  checkDbConnection();
  fetchStudents();
  loadPendingUsers();
  loadAllUsers();
  loadBackupStatus();
  initFormEditMode();
  // Periodically re-verify DB connection status
  setInterval(checkDbConnection, 15000);
});
