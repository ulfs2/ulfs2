const APP_VERSION = '2.4.0';
const API_BASE = window.location.protocol === 'file:'
  ? 'http://localhost:3000/api'
  : '/api';
window.API_BASE = API_BASE;

function getAuthToken() {
  return localStorage.getItem('hub_token') || '';
}
window.getAuthToken = getAuthToken;

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
  if (!response) {
    return { success: false, error: 'No response received from server' };
  }
  let body = '';
  try {
    body = await response.text();
  } catch (readErr) {
    return { success: false, error: 'Failed to read response body: ' + readErr.message, status: response.status || 0 };
  }

  let data = null;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    if (response.status === 401 || response.status === 403) {
      data = {
        success: false,
        error: 'Session expired or invalid. Please sign in again.',
        unauthenticated: true,
        status: response.status
      };
    } else if (response.status === 404) {
      data = {
        success: false,
        error: 'API endpoint not found (HTTP 404).',
        status: 404
      };
    } else if (response.status >= 500) {
      data = {
        success: false,
        error: `Server or network error (HTTP ${response.status}). Please try again shortly.`,
        status: response.status
      };
    } else {
      data = {
        success: false,
        error: `Server returned non-JSON response (HTTP ${response.status})`,
        status: response.status
      };
    }
  }

  if (!data || typeof data !== 'object') {
    data = { success: response.ok, data };
  }

  if (!response.ok) {
    if (!data.error) {
      data.error = data.message || `Request failed with HTTP ${response.status}`;
    }
    if (response.status === 401 || response.status === 403) {
      data.unauthenticated = true;
    }
  }

  return data;
}
window.parseApiResponse = parseApiResponse;

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
const linkFilter = document.querySelector('#linkFilter') || document.querySelector('#classFilter');
const classFilter = linkFilter;
const majorFilter = document.querySelector('#majorFilter');
const campusFilter = document.querySelector('#campusFilter');
const languageFilter = document.querySelector('#languageFilter');
const groupFilter = document.querySelector('#groupFilter');
const emailSentFilter = document.querySelector('#emailSentFilter');
const clearFilters = document.querySelector('#clearFilters');
const toast = document.querySelector('#toast');
const dbStatusPill = document.querySelector('#dbStatusPill');
const dbStatusText = document.querySelector('#dbStatusText');
const logoutBtn = document.querySelector('#logoutBtn');
const userNameDisplay = document.querySelector('#userNameDisplay');
const backupStatus = document.querySelector('#backupStatus');

let students = [];
let editingId = null;
let currentPoliticalGroup = 'all';

function getStudentAssignedGroup(student) {
  const norm = (student?.assignedGroup || '').trim().toLowerCase();
  if (norm === 'grp a' || norm === 'a') return 'Grp A';
  if (norm === 'grp b' || norm === 'b') return 'Grp B';
  if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
  if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
  if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
  if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
  if (norm === 'amchit' || norm === 'amshit' || norm === 'grp amchit' || norm === 'grp amshit') return 'Amchit';
  const campus = (student?.campus || '').trim().toLowerCase();
  if ((campus.includes('amchit') || campus.includes('amshit')) && student?.inGroup && !student?.leftGroup) return 'Amchit';
  return '';
}
let systemUsers = [];

const escapeHtml = (value = '') => String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));

// Academic Section Configuration
const MISPCE_MAJORS_LIST = ['Mathematics', 'Informatics', 'Statistics', 'Physics', 'Chemistry', 'Electronics'];
const CSVT_MAJORS_LIST = ['Biology', 'Biochemistry', 'Chemistry'];

function inferSectionFromMajor(major = '') {
  const norm = String(major || '').trim().toLowerCase();
  if (['biology', 'bio', 'biologie', 'biochemistry', 'biochimie', 'ciochimie'].includes(norm)) {
    return 'csvt';
  }
  return 'mispce';
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('hub_user') || '{}');
  } catch {
    return {};
  }
}

// Authentication Protection
function getCurrentUserRole() {
  const user = getCurrentUser();
  return (user.role || 'deleg').toLowerCase();
}

function getCurrentUserSection() {
  const user = getCurrentUser();
  const role = (user.role || 'deleg').toLowerCase();
  if (role === 'superadmin') return 'all';
  return (user.section || 'mispce').toLowerCase();
}

function isCurrentUserDeleg() {
  const role = getCurrentUserRole();
  return role !== 'admin' && role !== 'superadmin';
}

function applyUserRoleUI(user) {
  if (!user || typeof user !== 'object') return false;
  const currentPage = document.body?.dataset?.page;
  const role = (user.role || 'deleg').toLowerCase();
  const isSuperAdmin = role === 'superadmin';
  const isAdmin = role === 'admin' || isSuperAdmin;
  const isDeleg = !isAdmin;
  const userSec = (user.section || (isSuperAdmin ? 'all' : 'mispce')).toLowerCase();

  if (userNameDisplay) {
    let roleLabel = 'Deleg';
    if (isSuperAdmin) {
      roleLabel = 'Superadmin';
    } else if (role === 'admin') {
      roleLabel = userSec !== 'all' ? `Admin - ${userSec.toUpperCase()}` : 'Admin';
    } else {
      roleLabel = `Deleg - ${userSec.toUpperCase()}`;
    }
    userNameDisplay.textContent = `${user.fullName || user.username || 'User'} (${roleLabel})`;
    userNameDisplay.title = `Signed in as ${user.username} (${roleLabel})`;
  }

  if (isDeleg) {
    document.body.classList.add('role-deleg');

    // Hide restricted nav links (Kazaa, Users, Backups, Email Settings)
    document.querySelectorAll('.topbar .nav-links a[href*="kazaa"], .topbar .nav-links a[href*="users"], .topbar .nav-links a[href*="backup"], .topbar .nav-links a[href*="email-config"]').forEach(el => {
      el.style.display = 'none';
    });

    // Hide export button on dashboard
    const exportBtn = document.querySelector('#exportBtn');
    if (exportBtn) exportBtn.style.display = 'none';

    // Hide section distribution and political cards on dashboard
    const classInsightCard = document.querySelector('.class-insight-card');
    if (classInsightCard) classInsightCard.style.display = 'none';

    const politicalStatsCard = document.querySelector('.political-stats-card');
    if (politicalStatsCard) politicalStatsCard.style.display = 'none';

    // Deleg is restricted from: users, kazaa, kazaa-export, backup, email-config, and form.html in EDIT mode
    const restrictedPages = ['users', 'kazaa', 'kazaa-export', 'backup', 'email-config'];
    if (restrictedPages.includes(currentPage)) {
      window.location.replace('dashboard.html');
      return false;
    }
    if (currentPage === 'form' && new URLSearchParams(window.location.search).has('edit')) {
      window.location.replace('dashboard.html');
      return false;
    }
  } else {
    document.body.classList.remove('role-deleg');

    // Restore restricted nav links
    document.querySelectorAll('.topbar .nav-links a[href*="kazaa"], .topbar .nav-links a[href*="users"], .topbar .nav-links a[href*="backup"], .topbar .nav-links a[href*="email-config"]').forEach(el => {
      el.style.display = '';
    });

    const exportBtn = document.querySelector('#exportBtn');
    if (exportBtn) exportBtn.style.display = '';

    const classInsightCard = document.querySelector('.class-insight-card');
    if (classInsightCard) classInsightCard.style.display = '';

    const politicalStatsCard = document.querySelector('.political-stats-card');
    if (politicalStatsCard) politicalStatsCard.style.display = '';
  }

  // Show/hide Superadmin-only vCard export trigger buttons
  document.querySelectorAll('.export-vcard-trigger-btn').forEach(el => {
    el.style.display = isSuperAdmin ? '' : 'none';
  });

  return true;
}

let isSyncingSession = false;

async function syncCurrentUserSession(force = false) {
  const currentPage = document.body?.dataset?.page;
  if (currentPage === 'login' || currentPage === 'signup') return;
  const token = localStorage.getItem('hub_token');
  if (!token) return;
  if (isSyncingSession && !force) return;

  isSyncingSession = true;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await parseApiResponse(res);

    if (!res.ok || !json.success) {
      if (res.status === 401 || res.status === 403 || json.unauthenticated) {
        localStorage.removeItem('hub_user');
        localStorage.removeItem('hub_token');
        showToast('Session Expired', json.error || 'Please sign in again to continue.');
        setTimeout(() => window.location.replace('login.html'), 800);
      }
      return;
    }

    const serverUser = json.user;
    const serverToken = json.token;
    const serverVersion = json.version;

    // Check if a new version was deployed
    if (serverVersion && typeof APP_VERSION !== 'undefined' && serverVersion !== APP_VERSION) {
      showToast('System Updated', 'Applying latest changes...');
      setTimeout(() => window.location.reload(), 600);
      return;
    }

    const currentUser = getCurrentUser();
    const roleChanged = (currentUser.role || '').toLowerCase() !== (serverUser.role || '').toLowerCase();
    const sectionChanged = (currentUser.section || '').toLowerCase() !== (serverUser.section || '').toLowerCase();
    const nameChanged = (currentUser.fullName || currentUser.username) !== (serverUser.fullName || serverUser.username);
    const approvedChanged = currentUser.approved !== serverUser.approved;

    // Persist freshest credentials
    localStorage.setItem('hub_user', JSON.stringify(serverUser));
    if (serverToken) {
      localStorage.setItem('hub_token', serverToken);
    }

    if (roleChanged || sectionChanged || nameChanged || approvedChanged) {
      applyUserRoleUI(serverUser);

      if (currentPage === 'dashboard') {
        if (roleChanged) {
          if (typeof setupSectionSwitchTabs === 'function') setupSectionSwitchTabs();
          if (typeof fetchStudents === 'function') fetchStudents();
          showToast('Role Updated', `Your role has been updated to ${serverUser.role.toUpperCase()}.`);
        } else if (sectionChanged) {
          if (typeof setupSectionSwitchTabs === 'function') setupSectionSwitchTabs();
          if (typeof applySectionFilter === 'function') applySectionFilter();
          showToast('Section Updated', `Your section was updated to ${serverUser.section.toUpperCase()}.`);
        }
      } else if (currentPage === 'form') {
        if (typeof initStudentForm === 'function') initStudentForm();
      } else if (currentPage === 'users' && typeof loadAllUsers === 'function') {
        loadAllUsers();
      }
    }
  } catch (err) {
    // Non-fatal, will retry on next event or timer
  } finally {
    isSyncingSession = false;
  }
}

// Automatically sync user session on tab activation, window focus, or periodic interval
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncCurrentUserSession();
});
window.addEventListener('focus', () => syncCurrentUserSession());
setInterval(() => {
  syncCurrentUserSession();
}, 20000);

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
    const ok = applyUserRoleUI(user);
    if (!ok) return false;
  } catch (err) {
    localStorage.removeItem('hub_user');
    localStorage.removeItem('hub_token');
    window.location.replace('login.html');
    return false;
  }

  // Trigger background session sync
  syncCurrentUserSession();

  return true;
}

// Logout handler
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('hub_user');
    localStorage.removeItem('hub_token');
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
        <div>
          <strong>${escapeHtml(user.fullName)}</strong>
          <span>@${escapeHtml(user.username)}</span>
          <small>Requested ${new Date(user.createdAt).toLocaleDateString()} • Section: ${escapeHtml((user.section || 'mispce').toUpperCase())}</small>
        </div>
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

    let currentUser = null;
    try { currentUser = JSON.parse(localStorage.getItem('hub_user') || '{}'); } catch { currentUser = {}; }
    const currentRole = (currentUser.role || '').toLowerCase();
    const isCurrentSuperAdmin = currentRole === 'superadmin';

    allUsersList.innerHTML = json.data.length ? json.data.map(user => {
      const uRole = (user.role || 'deleg').toLowerCase();
      const uSection = (user.section || (uRole === 'superadmin' ? 'all' : 'mispce')).toLowerCase();
      let roleLabel = 'Deleg';
      let roleClass = 'role-deleg';
      if (uRole === 'superadmin') {
        roleLabel = 'Superadmin';
        roleClass = 'role-superadmin';
      } else if (uRole === 'admin') {
        roleLabel = uSection && uSection !== 'all' ? `Admin • ${uSection.toUpperCase()}` : 'Admin';
        roleClass = 'role-admin';
      } else {
        roleLabel = `Deleg • ${uSection.toUpperCase()}`;
        roleClass = 'role-deleg';
      }
      const isTargetSuperAdmin = uRole === 'superadmin';
      const canEdit = isCurrentSuperAdmin || !isTargetSuperAdmin;
      const canDelete = (isCurrentSuperAdmin || !isTargetSuperAdmin) && currentUser.id !== user.id;

      return `
      <article class="system-user">
        <div class="system-user-avatar">${escapeHtml(`${user.fullName?.[0] || user.username?.[0] || 'U'}`.toUpperCase())}</div>
        <div class="system-user-identity"><strong>${escapeHtml(user.fullName || user.username)}</strong><span>@${escapeHtml(user.username)}</span></div>
        <span class="user-role ${roleClass}">${escapeHtml(roleLabel)}</span>
        <span class="user-status ${user.approved ? 'approved' : 'pending'}">${user.approved ? 'Approved' : 'Pending'}</span>
        <small>${new Date(user.createdAt).toLocaleDateString()}</small>
        <div class="system-user-actions">
          ${canEdit ? `<button type="button" class="edit-user" onclick="openUserEditor('${user.id}')">Edit</button>` : ''}
          ${canDelete ? `<button type="button" class="delete-user" onclick="deleteSystemUser('${user.id}')">Delete</button>` : ''}
        </div>
      </article>`;
    }).join('') : '<p class="no-pending">No user accounts found.</p>';
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
  const normalizedRole = user.role === 'staff' ? 'deleg' : (user.role || 'deleg');
  editor.elements.role.value = normalizedRole;
  if (editor.elements.section) {
    editor.elements.section.value = user.section || (normalizedRole === 'superadmin' ? 'all' : 'mispce');
    editor.elements.section._syncCustomSelect?.();
  }
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

      const currentUser = getCurrentUser();
      if (currentUser && currentUser.id === id) {
        const updatedUser = {
          ...currentUser,
          ...json.data
        };
        localStorage.setItem('hub_user', JSON.stringify(updatedUser));
        if (json.token) localStorage.setItem('hub_token', json.token);
        applyUserRoleUI(updatedUser);
      }

      closeUserEditor();
      showToast('User updated', 'The account changes were saved and applied.');
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
    if (values.approved !== undefined) {
      values.approved = values.approved === 'true';
    }
    try {
      const token = localStorage.getItem('hub_token');
      const response = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(values)
      });
      const json = await parseApiResponse(response);
      if (!json.success) throw new Error(json.error || 'Could not create user');
      userForm.reset();
      if (json.data?.approved) {
        showToast('User created', `${values.fullName} is approved and can now sign in.`);
      } else {
        showToast('Account requested', `${values.fullName} requires administrator approval before sign-in.`);
      }
      loadPendingUsers();
      loadAllUsers();
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

let currentDashboardSection = 'all';
let allStudentsMaster = [];

function applySectionFilter() {
  currentStudentPage = 1;
  const userRole = getCurrentUserRole();
  const userSec = getCurrentUserSection();
  const isSuper = userRole === 'superadmin' || userSec === 'all';

  if (!isSuper) {
    const assignedSec = (userSec || 'mispce').toLowerCase();
    students = allStudentsMaster.filter(s => (s.section || (typeof inferSectionFromMajor === 'function' ? inferSectionFromMajor(s.major) : '') || '').toLowerCase() === assignedSec);
  } else if (currentDashboardSection && currentDashboardSection !== 'all') {
    students = allStudentsMaster.filter(s => (s.section || (typeof inferSectionFromMajor === 'function' ? inferSectionFromMajor(s.major) : '') || '').toLowerCase() === currentDashboardSection);
  } else {
    students = [...allStudentsMaster];
  }
  updateStats();
  renderStudents(searchInput ? searchInput.value : '');
}

// Fetch all students from backend
async function fetchStudents() {
  try {
    const url = `${API_BASE}/students`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }
    });
    const json = await parseApiResponse(res);
    if (json.success) {
      allStudentsMaster = json.data || [];
      applySectionFilter();
      if (typeof updateVCardExportModalStats === 'function') {
        updateVCardExportModalStats();
      }
    } else {
      console.error('Failed to fetch students:', json.error);
    }
  } catch (err) {
    console.error('Error connecting to backend:', err);
  }
}

let renderStudentsRaf = null;
function scheduleRenderStudents(query = '') {
  if (renderStudentsRaf) cancelAnimationFrame(renderStudentsRaf);
  renderStudentsRaf = requestAnimationFrame(() => {
    renderStudents(query);
    renderStudentsRaf = null;
  });
}

const STUDENTS_PER_PAGE = 20;
let currentStudentPage = 1;

// Render student grid and stats (for dashboard)
function renderStudents(query = '') {
  if (!recordsGrid) return;
  const needle = query.trim().toLowerCase();
  const tokens = needle ? needle.split(/\s+/).filter(Boolean) : [];
  const numericNeedle = /^[\s()+.-]*\d[\d\s()+.-]*$/.test(needle)
    ? needle.replace(/\D/g, '')
    : '';
  const filtered = students.filter(student => {
    const nameCombinations = [
      `${student.firstName || ''} ${student.familyName || ''}`,
      `${student.firstName || ''} ${student.fatherName || ''} ${student.familyName || ''}`,
      `${student.familyName || ''} ${student.firstName || ''}`
    ];
    const isAmchitStudent = (student.campus || '').toLowerCase().includes('am') || (student.assignedGroup || '').toLowerCase().includes('am');
    const campusAliases = isAmchitStudent ? 'amchit amshit' : '';
    const fullSearchText = [...nameCombinations, ...Object.values(student), campusAliases]
      .map(v => String(v || '').toLowerCase())
      .join(' ');
    const matchesFormattedText = tokens.every(token => fullSearchText.includes(token));
    const matchesUnformattedNumber = numericNeedle && Object.values(student).some(value =>
      String(value || '').replace(/\D/g, '').includes(numericNeedle)
    );
    const matchesSearch = !tokens.length || matchesFormattedText || matchesUnformattedNumber;
    const matchesStatus = !statusFilter?.value || String(student.status || '').trim().toLowerCase() === statusFilter.value.trim().toLowerCase();
    const isApproved = Boolean(student.linkApproved !== undefined ? student.linkApproved : student.inClass);
    const matchesLink = !linkFilter?.value || (linkFilter.value === 'approved' || linkFilter.value === 'in' ? isApproved : !isApproved);
    const matchesEmailSent = !emailSentFilter?.value
      || (emailSentFilter.value === 'sent' ? Boolean(student.emailSent) : !Boolean(student.emailSent));
    const matchesMajor = !majorFilter?.value || student.major === majorFilter.value;
    const targetCampus = (campusFilter?.value || '').trim().toLowerCase();
    const studentCampus = (student.campus || '').trim().toLowerCase();
    const matchesCampus = !targetCampus ||
      (targetCampus.includes('am') ? studentCampus.includes('am') : studentCampus === targetCampus);
    const matchesLanguage = !languageFilter?.value || student.language === languageFilter.value;
    const assignedGroup = getStudentAssignedGroup(student);
    const matchesGroup = !groupFilter?.value
      || (groupFilter.value === 'in' ? (student.inGroup && !student.leftGroup)
        : groupFilter.value === 'out' ? (!student.inGroup && !student.leftGroup)
        : groupFilter.value === 'left' ? Boolean(student.leftGroup)
        : groupFilter.value === 'unassigned' ? (!assignedGroup && !student.leftGroup)
        : groupFilter.value === 'Grp A,B' ? (assignedGroup === 'Grp A,B' || assignedGroup === 'Grp A' || assignedGroup === 'Grp B')
        : groupFilter.value === assignedGroup);
    return matchesSearch && matchesStatus && matchesLink && matchesEmailSent && matchesMajor && matchesCampus && matchesLanguage && matchesGroup;
  });

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / STUDENTS_PER_PAGE) || 1;
  if (currentStudentPage > totalPages) currentStudentPage = totalPages;
  if (currentStudentPage < 1) currentStudentPage = 1;

  const startIndex = (currentStudentPage - 1) * STUDENTS_PER_PAGE;
  const endIndex = Math.min(startIndex + STUDENTS_PER_PAGE, totalItems);
  const pageItems = filtered.slice(startIndex, endIndex);

  if (recordCount) recordCount.textContent = students.length;
  const directorySummary = document.querySelector('#directorySummary');
  if (directorySummary) {
    const filtering = needle || statusFilter?.value || linkFilter?.value || emailSentFilter?.value || majorFilter?.value || campusFilter?.value || languageFilter?.value || groupFilter?.value;
    directorySummary.textContent = filtering
      ? `${filtered.length} of ${students.length} students`
      : `${students.length} student${students.length === 1 ? '' : 's'}`;
  }

  if (emptyState) {
    emptyState.style.display = filtered.length ? 'none' : 'block';
    const filtering = needle || statusFilter?.value || linkFilter?.value || emailSentFilter?.value || majorFilter?.value || campusFilter?.value || languageFilter?.value || groupFilter?.value;
    const emptyDesc = emptyState.querySelector('p');
    const emptyBtn = emptyState.querySelector('.btn-primary');
    if (emptyDesc && filtering) {
      const activeFilterNames = [
        needle ? `search "${needle}"` : '',
        statusFilter?.value ? `status "${statusFilter.value}"` : '',
        campusFilter?.value ? `campus "${campusFilter.value}"` : '',
        groupFilter?.value ? `group "${groupFilter.value}"` : '',
        majorFilter?.value ? `major "${majorFilter.value}"` : '',
        linkFilter?.value ? `group link "${linkFilter.value}"` : '',
        emailSentFilter?.value ? `email "${emailSentFilter.value === 'sent' ? 'sent' : 'not sent'}"` : ''
      ].filter(Boolean).join(', ');
      emptyDesc.textContent = `No students match the current filters (${activeFilterNames}).`;
      if (emptyBtn) {
        emptyBtn.textContent = '✕ Reset All Filters';
        emptyBtn.onclick = (e) => {
          e.preventDefault();
          if (clearFilters) clearFilters.click();
        };
      }
    } else if (emptyDesc) {
      emptyDesc.textContent = 'No student records match your filter or the database is currently empty.';
      if (emptyBtn) {
        emptyBtn.textContent = '+ Add First Student';
        emptyBtn.onclick = null;
        emptyBtn.href = 'form.html';
      }
    }
  }

  updateActiveStatCardStates();

  const isDeleg = isCurrentUserDeleg();

  recordsGrid.innerHTML = pageItems.map(student => {
    const fullName = `${student.firstName} ${student.fatherName} ${student.familyName}`;
    const initials = `${student.firstName?.[0] || ''}${student.familyName?.[0] || ''}`.toUpperCase();
    const lang = (student.language || '').trim().toLowerCase();
    const campus = (student.campus || '').trim().toLowerCase();
    const isAmchit = campus.includes('amchit') || campus.includes('amshit');
    const isFrench = lang.includes('french');
    const isEnglish = lang.includes('english');
    const isLeft = Boolean(student.leftGroup);
    const groupDisabledAttr = isLeft ? 'disabled title="This student left the group"' : '';

    let groupButtonsHtml = '';
    const assigned = getStudentAssignedGroup(student);
    if (isAmchit) {
      const isAmchitActive = assigned === 'Amchit';
      groupButtonsHtml = `
          <div class="group-section-actions">
            <button type="button"
              class="btn-action group-section-btn ${isAmchitActive ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Amchit', this)"
              aria-pressed="${isAmchitActive ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isAmchitActive ? '✓ Amchit' : 'Amchit'}
            </button>
          </div>
      `;
    } else if (isFrench) {
      const isA = assigned === 'Grp A';
      const isB = assigned === 'Grp B';
      const isCD = assigned === 'Grp C,D';
      groupButtonsHtml = `
          <div class="group-section-actions">
            <button type="button"
              class="btn-action group-section-btn ${isA ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Grp A', this)"
              aria-pressed="${isA ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isA ? '✓ Grp A' : 'Grp A'}
            </button>
            <button type="button"
              class="btn-action group-section-btn ${isB ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Grp B', this)"
              aria-pressed="${isB ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isB ? '✓ Grp B' : 'Grp B'}
            </button>
            <button type="button"
              class="btn-action group-section-btn ${isCD ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Grp C,D', this)"
              aria-pressed="${isCD ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isCD ? '✓ Grp C,D' : 'Grp C,D'}
            </button>
          </div>
      `;
    } else if (isEnglish) {
      const isE1 = assigned === 'Grp E1';
      const isE2 = assigned === 'Grp E2';
      groupButtonsHtml = `
          <div class="group-section-actions">
            <button type="button"
              class="btn-action group-section-btn ${isE1 ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Grp E1', this)"
              aria-pressed="${isE1 ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isE1 ? '✓ Grp E1' : 'Grp E1'}
            </button>
            <button type="button"
              class="btn-action group-section-btn ${isE2 ? 'is-active' : ''}"
              onclick="setStudentAssignedGroup('${student.id}', 'Grp E2', this)"
              aria-pressed="${isE2 ? 'true' : 'false'}"
              ${groupDisabledAttr}>
              ${isE2 ? '✓ Grp E2' : 'Grp E2'}
            </button>
          </div>
      `;
    }

    const studentSec = (student.section || inferSectionFromMajor(student.major) || 'mispce').toLowerCase();

    return `
      <article class="student-card ${Boolean(student.emailSent) ? 'has-email-sent' : ''}">
        <span class="tag">${escapeHtml(student.status)}</span>
        <div class="student-top">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div class="student-top-info">
            <div class="student-name-row">
              <h3>${escapeHtml(fullName)}</h3>
              <button type="button"
                class="btn-email-status-icon ${Boolean(student.emailSent) ? 'is-sent' : ''}"
                onclick="toggleStudentEmailSent('${student.id}', ${!Boolean(student.emailSent)}, this)"
                title="${Boolean(student.emailSent) ? 'Email marked sent to student (click to unmark)' : `Email not marked sent to ${escapeHtml(fullName)} (click to mark sent)`}"
                aria-label="${Boolean(student.emailSent) ? 'Email sent to student' : 'Mark email as sent'}"
                aria-pressed="${Boolean(student.emailSent) ? 'true' : 'false'}">
                ${Boolean(student.emailSent) ? `
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9"/>
                    <polyline points="22,6 12,13 2,6"/>
                    <polyline points="16 19 19 22 24 17"/>
                  </svg>
                ` : `
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect width="20" height="16" x="2" y="4" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                `}
              </button>
              <button type="button"
                class="btn-approve-class-icon ${Boolean(student.linkApproved) ? 'is-approved' : ''}"
                onclick="toggleStudentLinkApproval('${student.id}', ${!Boolean(student.linkApproved)}, this)"
                title="${Boolean(student.linkApproved) ? 'Link sent & approved joined group' : `Send link & approve ${escapeHtml(fullName)} joined group`}"
                aria-label="${Boolean(student.linkApproved) ? 'Link sent & approved joined group' : `Send link & approve ${escapeHtml(fullName)} joined group`}"
                aria-pressed="${Boolean(student.linkApproved) ? 'true' : 'false'}">
                ${Boolean(student.linkApproved) ? `
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ` : `
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                `}
              </button>
            </div>
            <p>${escapeHtml(student.major)} • ${escapeHtml(studentSec.toUpperCase())}</p>
          </div>
        </div>
        <div class="student-details">
          <div class="detail"><small>Major</small><span title="${escapeHtml(student.major)}">${escapeHtml(student.major)}</span></div>
          <div class="detail"><small>Section</small><span>${escapeHtml(studentSec.toUpperCase())}</span></div>
          <div class="detail"><small>School</small><span title="${escapeHtml(student.school)}">${escapeHtml(student.school)}</span></div>
          <div class="detail"><small>Campus</small><span>${escapeHtml(student.campus)}</span></div>
          <div class="detail"><small>Language</small><span>${escapeHtml(student.language)}</span></div>
          <div class="detail">
            <small>Phone</small>
            <div class="phone-row">
              ${student.phone ? `<a href="tel:${escapeHtml(String(student.phone).trim())}" class="phone-link" title="Call ${escapeHtml(fullName)}">${escapeHtml(student.phone)}</a>` : '<span>N/A</span>'}
              ${student.phone ? `
                <button type="button" class="btn-contact-quick" onclick="saveStudentContact('${student.id}')" title="Save ${escapeHtml(fullName)} to contacts" aria-label="Save ${escapeHtml(fullName)} to phone contacts">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="detail email-detail">
            <small>Email</small>
            <div class="email-row">
              ${student.email ? `<span title="${escapeHtml(student.email)}" class="email-text">${escapeHtml(student.email)}</span>` : '<span>N/A</span>'}
              ${student.email ? `
                <button type="button" class="btn-contact-quick btn-email-quick" onclick="openEmailModalForStudent('${student.id}')" title="Send invitation email to ${escapeHtml(fullName)}" aria-label="Send invitation email to ${escapeHtml(fullName)}">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect width="20" height="16" x="2" y="4" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                </button>
                <button type="button"
                  class="btn-email-sent-badge ${Boolean(student.emailSent) ? 'is-sent' : 'is-unsent'}"
                  onclick="toggleStudentEmailSent('${student.id}', ${!Boolean(student.emailSent)}, this)"
                  title="${Boolean(student.emailSent) ? 'Email marked as sent (click to unmark)' : 'Email not marked as sent (click to mark sent)'}"
                  aria-label="${Boolean(student.emailSent) ? 'Email sent to student' : 'Mark email sent'}"
                  aria-pressed="${Boolean(student.emailSent) ? 'true' : 'false'}">
                  ${Boolean(student.emailSent) ? `
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>Sent</span>
                  ` : `
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>Mark Sent</span>
                  `}
                </button>
              ` : ''}
            </div>
          </div>
          <div class="detail"><small>Origin</small><span>${escapeHtml(student.origin || 'N/A')}</span></div>
          ${!isDeleg ? `
          <div class="detail political-detail">
            <small>Political affiliation</small>
            ${student.politicalAffiliation ? `
              <span class="political-value" aria-live="polite">••••••••</span>
              <button type="button" class="reveal-affiliation" data-student-id="${escapeHtml(student.id)}" aria-expanded="false">Show affiliation</button>
            ` : '<span>Not provided</span>'}
          </div>` : ''}
        </div>
        ${!isDeleg && student.note ? `<div class="student-note"><strong>Note</strong><p>${escapeHtml(student.note)}</p></div>` : ''}
        <div class="card-actions">
          <button type="button"
            class="btn-action group-toggle ${student.inGroup ? 'is-in-group' : ''}"
            onclick="toggleGroupMembership('${student.id}', ${!student.inGroup}, this)"
            aria-pressed="${student.inGroup ? 'true' : 'false'}"
            ${student.leftGroup ? 'disabled title="This student left the group"' : ''}>
            ${student.leftGroup ? 'In group (disabled)' : (student.inGroup ? (student.assignedGroup ? `✓ In group (${escapeHtml(student.assignedGroup)})` : '✓ In group') : '+ Add to group')}
          </button>
          ${student.inGroup && !student.leftGroup ? `
            <button type="button" class="btn-action left-group"
              onclick="markStudentLeftGroup('${student.id}', this)">Left group</button>
          ` : student.leftGroup ? '<span class="left-group-status">Left group</span>' : ''}
          <button type="button"
            class="btn-action email-invite-card-btn"
            onclick="sendStudentEmailAutomatically('${student.id}', this)"
            title="${Boolean(student.emailSent) ? `Email already sent to ${escapeHtml(fullName)} — click to send again` : `Send an invitation email to ${escapeHtml(fullName)}`}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect width="20" height="16" x="2" y="4" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
            Send Email
          </button>
          ${groupButtonsHtml}
          ${!isDeleg ? `
          <div class="record-edit-actions">
          <a class="btn-action edit" href="form.html?edit=${student.id}">Edit record</a>
          <button type="button" class="btn-action student-note-button" data-student-id="${escapeHtml(student.id)}">${student.note ? 'Edit Note' : 'Add Note'}</button>
          <button type="button" class="btn-action delete" onclick="deleteStudentRecord('${student.id}')">Delete</button>
          </div>` : ''}
        </div>
      </article>
    `;
  }).join('');

  renderPagination(totalItems, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const nav = document.querySelector('#paginationNav');
  if (!nav) return;

  if (totalItems <= STUDENTS_PER_PAGE) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;

  const info = document.querySelector('#paginationInfo');
  if (info) {
    const startNum = totalItems === 0 ? 0 : (currentStudentPage - 1) * STUDENTS_PER_PAGE + 1;
    const endNum = Math.min(currentStudentPage * STUDENTS_PER_PAGE, totalItems);
    info.textContent = `Showing ${startNum}–${endNum} of ${totalItems} students (Page ${currentStudentPage} of ${totalPages})`;
  }

  const controls = document.querySelector('#paginationControls');
  if (!controls) return;

  let html = '';
  const prevDisabled = currentStudentPage === 1 ? 'disabled' : '';
  html += `<button type="button" class="pagination-btn pagination-prev" ${prevDisabled} data-page="${currentStudentPage - 1}" aria-label="Previous page">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    <span>Prev</span>
  </button>`;

  const maxButtons = 5;
  let startPage = Math.max(1, currentStudentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="pagination-btn" data-page="1">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">…</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    const isActive = p === currentStudentPage ? 'is-active' : '';
    html += `<button type="button" class="pagination-btn ${isActive}" data-page="${p}">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">…</span>`;
    html += `<button type="button" class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  const nextDisabled = currentStudentPage === totalPages ? 'disabled' : '';
  html += `<button type="button" class="pagination-btn pagination-next" ${nextDisabled} data-page="${currentStudentPage + 1}" aria-label="Next page">
    <span>Next</span>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  </button>`;

  controls.innerHTML = html;
}

const paginationControls = document.querySelector('#paginationControls');
if (paginationControls) {
  paginationControls.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const target = parseInt(btn.dataset.page, 10);
    if (target && target !== currentStudentPage) {
      currentStudentPage = target;
      renderStudents(searchInput ? searchInput.value : '');
      const heading = document.querySelector('.directory-heading');
      if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
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
  const leftGroupCount = students.filter(student => student.leftGroup).length;
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

  const isNew = s => String(s.status || '').trim().toLowerCase() === 'new';
  const isMu3id = s => String(s.status || '').trim().toLowerCase() === 'mu3id';

  const linkApprovedStudents = students.filter(student => Boolean(student.linkApproved));
  const linkApprovedCount = linkApprovedStudents.length;
  const linkApprovedNewCount = linkApprovedStudents.filter(isNew).length;
  const linkApprovedMu3idCount = linkApprovedStudents.filter(isMu3id).length;

  const groupStudentsList = students.filter(student => student.inGroup && !student.leftGroup);
  const groupNewCount = groupStudentsList.filter(isNew).length;
  const groupMu3idCount = groupStudentsList.filter(isMu3id).length;

  const leftGroupStudentsList = students.filter(student => Boolean(student.leftGroup));
  const leftGroupNewCount = leftGroupStudentsList.filter(isNew).length;
  const leftGroupMu3idCount = leftGroupStudentsList.filter(isMu3id).length;

  setText('#totalStudents', total);
  setText('#newStudents', newCount);
  setText('#returningStudents', returningCount);
  setText('#schoolCount', schools);
  setText('#linkApprovedStudents', linkApprovedCount);
  setText('#linkApprovedPercentage', `${percent(linkApprovedCount)}% of total`);
  setText('#linkApprovedNewCount', linkApprovedNewCount);
  setText('#linkApprovedMu3idCount', linkApprovedMu3idCount);
  setText('#classStudents', linkApprovedCount);
  setText('#classPercentage', `${percent(linkApprovedCount)}% of total`);
  setText('#classNewCount', linkApprovedNewCount);
  setText('#classMu3idCount', linkApprovedMu3idCount);
  setText('#groupStudents', groupCount);
  setText('#groupPercentage', `${percent(groupCount)}% of total`);
  setText('#groupNewCount', groupNewCount);
  setText('#groupMu3idCount', groupMu3idCount);
  setText('#leftGroupStudents', leftGroupCount);
  setText('#leftGroupPercentage', `${percent(leftGroupCount)}% of total`);
  setText('#leftGroupNewCount', leftGroupNewCount);
  setText('#leftGroupMu3idCount', leftGroupMu3idCount);
  const emailSentCount = students.filter(student => Boolean(student.emailSent)).length;
  setText('#emailSentStudents', emailSentCount);
  setText('#emailSentPercentage', `${percent(emailSentCount)}% of total`);
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

  const userRole = getCurrentUserRole();
  const userSec = getCurrentUserSection();
  const isSuper = userRole === 'superadmin' || userSec === 'all';
  const activeSection = isSuper ? currentDashboardSection : userSec;

  let visibleMajors = ['Mathematics', 'Informatics', 'Statistics', 'Physics', 'Chemistry', 'Electronics', 'Biology', 'Biochemistry'];
  if (activeSection === 'mispce') {
    visibleMajors = MISPCE_MAJORS_LIST;
  } else if (activeSection === 'csvt') {
    visibleMajors = CSVT_MAJORS_LIST;
  }

  const majorCountBadge = document.querySelector('#majorCountBadge');
  if (majorCountBadge) {
    majorCountBadge.textContent = `${visibleMajors.length} majors`;
  }

  document.querySelectorAll('.major-stat').forEach(card => {
    const major = card.dataset.major;
    const isVisible = visibleMajors.some(m => m.toLowerCase() === major.toLowerCase());
    card.style.display = isVisible ? '' : 'none';
    if (isVisible) {
      const majorCount = students.filter(student => (student.major || '').toLowerCase() === major.toLowerCase()).length;
      const majorPercent = percent(majorCount);
      card.querySelector('b').textContent = majorCount;
      card.querySelector('i').style.width = `${majorPercent}%`;
      card.querySelector('small').textContent = `${majorPercent}% of students`;
    }
  });

  updateMajorFilterOptions(visibleMajors);

  const grpAStudents = students.filter(s => getStudentAssignedGroup(s) === 'Grp A');
  const grpBStudents = students.filter(s => getStudentAssignedGroup(s) === 'Grp B');
  const grpABStudents = students.filter(s => getStudentAssignedGroup(s) === 'Grp A,B');
  const grpCDStudents = students.filter(s => getStudentAssignedGroup(s) === 'Grp C,D');
  const grpE1Students = students.filter(s => getStudentAssignedGroup(s) === 'Grp E1');
  const grpE2Students = students.filter(s => getStudentAssignedGroup(s) === 'Grp E2');
  const grpAmchitStudents = students.filter(s => getStudentAssignedGroup(s) === 'Amchit');
  const unassignedStudents = students.filter(s => !getStudentAssignedGroup(s));

  const grpA = grpAStudents.length;
  const grpB = grpBStudents.length;
  const grpAB = grpABStudents.length;
  const grpCD = grpCDStudents.length;
  const grpE1 = grpE1Students.length;
  const grpE2 = grpE2Students.length;
  const grpAmchit = grpAmchitStudents.length;
  const unassigned = unassignedStudents.length;

  setText('#grpACount', grpA);
  setText('#grpBCount', grpB);
  setText('#grpABCount', grpAB + grpA + grpB);
  setText('#grpCDCount', grpCD);
  setText('#grpE1Count', grpE1);
  setText('#grpE2Count', grpE2);
  setText('#grpAmchitCount', grpAmchit);
  setText('#unassignedCount', unassigned);

  setText('#grpANew', grpAStudents.filter(isNew).length);
  setText('#grpAMu3id', grpAStudents.filter(isMu3id).length);
  setText('#grpBNew', grpBStudents.filter(isNew).length);
  setText('#grpBMu3id', grpBStudents.filter(isMu3id).length);
  setText('#grpCDNew', grpCDStudents.filter(isNew).length);
  setText('#grpCDMu3id', grpCDStudents.filter(isMu3id).length);
  setText('#grpE1New', grpE1Students.filter(isNew).length);
  setText('#grpE1Mu3id', grpE1Students.filter(isMu3id).length);
  setText('#grpE2New', grpE2Students.filter(isNew).length);
  setText('#grpE2Mu3id', grpE2Students.filter(isMu3id).length);
  setText('#grpAmchitNew', grpAmchitStudents.filter(isNew).length);
  setText('#grpAmchitMu3id', grpAmchitStudents.filter(isMu3id).length);
  setText('#unassignedNew', unassignedStudents.filter(isNew).length);
  setText('#unassignedMu3id', unassignedStudents.filter(isMu3id).length);

  setText('#grpAPercent', `${percent(grpA)}% of students`);
  setText('#grpBPercent', `${percent(grpB)}% of students`);
  setText('#grpABPercent', `${percent(grpAB + grpA + grpB)}% of students`);
  setText('#grpCDPercent', `${percent(grpCD)}% of students`);
  setText('#grpE1Percent', `${percent(grpE1)}% of students`);
  setText('#grpE2Percent', `${percent(grpE2)}% of students`);
  setText('#grpAmchitPercent', `${percent(grpAmchit)}% of students`);
  setText('#unassignedPercent', `${percent(unassigned)}% of students`);

  const grpABar = document.querySelector('#grpABar');
  const grpBBar = document.querySelector('#grpBBar');
  const grpABBar = document.querySelector('#grpABBar');
  const grpCDBar = document.querySelector('#grpCDBar');
  const grpE1Bar = document.querySelector('#grpE1Bar');
  const grpE2Bar = document.querySelector('#grpE2Bar');
  const grpAmchitBar = document.querySelector('#grpAmchitBar');
  const unassignedBar = document.querySelector('#unassignedBar');

  if (grpABar) grpABar.style.width = `${percent(grpA)}%`;
  if (grpBBar) grpBBar.style.width = `${percent(grpB)}%`;
  if (grpABBar) grpABBar.style.width = `${percent(grpAB + grpA + grpB)}%`;
  if (grpCDBar) grpCDBar.style.width = `${percent(grpCD)}%`;
  if (grpE1Bar) grpE1Bar.style.width = `${percent(grpE1)}%`;
  if (grpE2Bar) grpE2Bar.style.width = `${percent(grpE2)}%`;
  if (grpAmchitBar) grpAmchitBar.style.width = `${percent(grpAmchit)}%`;
  if (unassignedBar) unassignedBar.style.width = `${percent(unassigned)}%`;

  if (!isCurrentUserDeleg()) {
    renderPoliticalStats();
  }
}

function updateMajorFilterOptions(visibleMajors) {
  if (!majorFilter) return;
  const currentVal = majorFilter.value;
  const optionsHtml = [
    '<option value="">All majors</option>',
    ...visibleMajors.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
  ].join('');
  if (majorFilter.innerHTML !== optionsHtml) {
    majorFilter.innerHTML = optionsHtml;
    if (visibleMajors.some(m => m.toLowerCase() === currentVal.toLowerCase())) {
      majorFilter.value = currentVal;
    } else {
      majorFilter.value = '';
    }
    majorFilter._rebuildCustomSelect?.();
  }
}

function setupSectionSwitchTabs() {
  const switchTabs = document.querySelector('#sectionSwitchTabs');
  if (!switchTabs) return;

  const userRole = getCurrentUserRole();
  const userSec = getCurrentUserSection();
  const isSuper = userRole === 'superadmin' || userSec === 'all';

  if (isSuper) {
    switchTabs.style.display = 'inline-flex';
    switchTabs.querySelectorAll('.hero-section-btn').forEach(tab => {
      tab.onclick = () => {
        switchTabs.querySelectorAll('.hero-section-btn').forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        currentDashboardSection = tab.dataset.section || 'all';
        applySectionFilter();
      };
    });
  } else {
    switchTabs.style.display = 'none';
  }
}

function getStudentsForPoliticalGroup(groupKey) {
  if (groupKey === 'Grp A') return students.filter(s => getStudentAssignedGroup(s) === 'Grp A');
  if (groupKey === 'Grp B') return students.filter(s => getStudentAssignedGroup(s) === 'Grp B');
  if (groupKey === 'Grp A,B') return students.filter(s => ['Grp A,B', 'Grp A', 'Grp B'].includes(getStudentAssignedGroup(s)));
  if (groupKey === 'Grp C,D') return students.filter(s => getStudentAssignedGroup(s) === 'Grp C,D');
  if (groupKey === 'Grp E1') return students.filter(s => getStudentAssignedGroup(s) === 'Grp E1');
  if (groupKey === 'Grp E2') return students.filter(s => getStudentAssignedGroup(s) === 'Grp E2');
  if (groupKey === 'Amchit') return students.filter(s => getStudentAssignedGroup(s) === 'Amchit');
  if (groupKey === 'in_group') return students.filter(s => s.inGroup && !s.leftGroup);
  if (groupKey === 'not_in_group') return students.filter(s => !s.inGroup && !s.leftGroup);
  return students;
}

const POLITICAL_GROUP_LABELS = {
  all: 'All students',
  'Grp A': 'Grp A (French)',
  'Grp B': 'Grp B (French)',
  'Grp A,B': 'Grp A,B (French)',
  'Grp C,D': 'Grp C,D (French)',
  'Grp E1': 'Grp E1 (English)',
  'Grp E2': 'Grp E2 (English)',
  'Amchit': 'Amchit',
  in_group: 'All in group',
  not_in_group: 'Not in group'
};

function renderPoliticalStats() {
  const politicalStatsGrid = document.querySelector('#politicalStatsGrid');
  const politicalGroupTitle = document.querySelector('#politicalGroupTitle');
  const politicalGroupSub = document.querySelector('#politicalGroupSub');

  const activeSubset = getStudentsForPoliticalGroup(currentPoliticalGroup);
  const activeTotal = activeSubset.length;
  const overallTotal = students.length;

  if (politicalGroupTitle) {
    politicalGroupTitle.textContent = POLITICAL_GROUP_LABELS[currentPoliticalGroup] || currentPoliticalGroup;
  }
  if (politicalGroupSub) {
    const overallPct = overallTotal ? Math.round(activeTotal / overallTotal * 100) : 0;
    politicalGroupSub.textContent = currentPoliticalGroup === 'all'
      ? `${activeTotal} student${activeTotal === 1 ? '' : 's'}`
      : `${activeTotal} student${activeTotal === 1 ? '' : 's'} (${overallPct}% of total)`;
  }

  if (politicalStatsGrid) {
    const affiliationCounts = activeSubset.reduce((counts, student) => {
      const affiliation = (student.politicalAffiliation || '').trim() || 'Not provided';
      counts[affiliation] = (counts[affiliation] || 0) + 1;
      return counts;
    }, {});
    const rows = Object.entries(affiliationCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const subsetPercent = count => activeTotal ? Math.round(count / activeTotal * 100) : 0;
    politicalStatsGrid.innerHTML = rows.length ? rows.map(([affiliation, affiliationCount]) => {
      const affiliationPercent = subsetPercent(affiliationCount);
      return `
        <div class="political-stat-row">
          <div class="political-stat-copy"><span>${escapeHtml(affiliation)}</span><b>${affiliationCount} <small>(${affiliationPercent}%)</small></b></div>
          <div class="political-stat-progress" aria-hidden="true"><i style="width:${affiliationPercent}%"></i></div>
        </div>`;
    }).join('') : '<p class="political-stats-empty">No student records in this group.</p>';
  }
}

function setupPoliticalTabs() {
  if (isCurrentUserDeleg()) return;
  const container = document.querySelector('.political-group-selector');
  if (!container) return;
  container.addEventListener('click', event => {
    const tab = event.target.closest('.political-group-tab');
    if (!tab) return;
    container.querySelectorAll('.political-group-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    currentPoliticalGroup = tab.dataset.group || 'all';
    renderPoliticalStats();
  });
}

function setupClassStatClicks() {
  if (isCurrentUserDeleg()) return;
  document.querySelectorAll('.class-stat').forEach(card => {
    card.addEventListener('click', () => {
      const grp = card.dataset.group;
      if (!groupFilter) return;
      if (groupFilter.value === grp) {
        groupFilter.value = '';
      } else {
        groupFilter.value = grp;
      }
      groupFilter.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleRenderStudents(searchInput ? searchInput.value : '');
      const recordsGrid = document.querySelector('#recordsGrid');
      if (recordsGrid) {
        recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.querySelectorAll('[data-link-filter], [data-class-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.linkFilter || el.dataset.classFilter;
      const targetFilter = linkFilter || classFilter;
      if (!targetFilter) return;
      targetFilter.value = (targetFilter.value === val) ? '' : val;
      targetFilter.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleRenderStudents(searchInput ? searchInput.value : '');
      const recordsGrid = document.querySelector('#recordsGrid');
      if (recordsGrid) {
        recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.querySelectorAll('[data-group-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.groupFilter;
      if (!groupFilter) return;
      groupFilter.value = (groupFilter.value === val) ? '' : val;
      groupFilter.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleRenderStudents(searchInput ? searchInput.value : '');
      const recordsGrid = document.querySelector('#recordsGrid');
      if (recordsGrid) {
        recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.querySelectorAll('[data-status-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.statusFilter;
      if (!statusFilter) return;
      statusFilter.value = (statusFilter.value === val) ? '' : val;
      statusFilter.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleRenderStudents(searchInput ? searchInput.value : '');
      const recordsGrid = document.querySelector('#recordsGrid');
      if (recordsGrid) {
        recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  document.querySelectorAll('[data-email-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.emailFilter;
      if (!emailSentFilter) return;
      emailSentFilter.value = (emailSentFilter.value === val) ? '' : val;
      emailSentFilter.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleRenderStudents(searchInput ? searchInput.value : '');
      const recordsGrid = document.querySelector('#recordsGrid');
      if (recordsGrid) {
        recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  updateActiveStatCardStates();
}

function updateActiveStatCardStates() {
  const activeStatus = statusFilter ? statusFilter.value : '';
  const activeLink = linkFilter ? linkFilter.value : '';
  const activeGroup = groupFilter ? groupFilter.value : '';
  const activeEmailSent = emailSentFilter ? emailSentFilter.value : '';

  document.querySelectorAll('[data-status-filter]').forEach(el => {
    el.classList.toggle('is-active-filter', Boolean(activeStatus && el.dataset.statusFilter === activeStatus));
  });
  document.querySelectorAll('[data-link-filter], [data-class-filter]').forEach(el => {
    const val = el.dataset.linkFilter || el.dataset.classFilter;
    const isMatch = Boolean(activeLink && (val === activeLink || (activeLink === 'approved' && val === 'in') || (activeLink === 'in' && val === 'approved')));
    el.classList.toggle('is-active-filter', isMatch);
  });
  document.querySelectorAll('[data-group-filter]').forEach(el => {
    el.classList.toggle('is-active-filter', Boolean(activeGroup && el.dataset.groupFilter === activeGroup));
  });
  document.querySelectorAll('[data-email-filter]').forEach(el => {
    el.classList.toggle('is-active-filter', Boolean(activeEmailSent && el.dataset.emailFilter === activeEmailSent));
  });
}

async function setStudentAssignedGroup(id, targetGroup, button) {
  const student = students.find(item => String(item.id) === String(id));
  if (!student) return;

  const currentNorm = (student.assignedGroup || '').trim().toLowerCase();
  const targetNorm = targetGroup.trim().toLowerCase();
  const isAlreadyInTarget = currentNorm === targetNorm || currentNorm === targetNorm.replace(/^grp\s*/, '');
  const nextGroup = isAlreadyInTarget ? '' : targetGroup;
  const nextInGroup = Boolean(nextGroup);

  const currentGroup = getStudentAssignedGroup(student) || (student.assignedGroup ? student.assignedGroup.trim() : '');
  if (currentGroup && !isAlreadyInTarget) {
    const studentName = [student.firstName, student.fatherName, student.familyName]
      .map(part => (part || '').trim())
      .filter(Boolean)
      .join(' ');
    const studentLabel = studentName ? `for ${studentName}` : 'for this student';
    const confirmed = await showPopup({
      title: 'Change student group?',
      message: `Do you really want to change the group ${studentLabel} from ${currentGroup} to ${targetGroup}?`,
      confirmLabel: 'Change group',
      cancelLabel: 'Cancel',
      showCancel: true,
      icon: '?'
    });
    if (!confirmed) return;
  }

  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inGroup: nextInGroup,
        assignedGroup: nextGroup,
        leftGroup: false
      })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update assigned group');

    student.inGroup = nextInGroup;
    student.assignedGroup = nextGroup;
    student.leftGroup = false;

    if (typeof allStudentsMaster !== 'undefined' && Array.isArray(allStudentsMaster)) {
      const master = allStudentsMaster.find(item => String(item.id) === String(id));
      if (master && master !== student) {
        master.inGroup = nextInGroup;
        master.assignedGroup = nextGroup;
        master.leftGroup = false;
      }
    }

    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');
    showToast(
      nextGroup ? `Assigned to ${nextGroup}` : 'Group assignment removed',
      nextGroup ? `The student is now assigned to ${nextGroup}.` : 'The student has no assigned group section.'
    );
  } catch (err) {
    if (button) button.disabled = false;
    await showPopup({ title: 'Could not update group', message: err.message, danger: true });
  }
}

async function toggleStudentLinkApproval(id, linkApproved, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/link-approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkApproved })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update link approval');

    const student = students.find(item => String(item.id) === String(id));
    if (student) {
      student.linkApproved = linkApproved;
      student.inClass = linkApproved;
    }
    if (typeof allStudentsMaster !== 'undefined' && Array.isArray(allStudentsMaster)) {
      const master = allStudentsMaster.find(item => String(item.id) === String(id));
      if (master && master !== student) {
        master.linkApproved = linkApproved;
        master.inClass = linkApproved;
      }
    }
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');
    showToast(
      linkApproved ? 'Link Sent & Approved' : 'Approval Removed',
      linkApproved ? 'Student marked as link sent & approved to joined group.' : 'Link approval was removed for this student.'
    );
  } catch (err) {
    if (button) button.disabled = false;
    await showPopup({ title: 'Could not update approval', message: err.message, danger: true });
  }
}

const toggleStudentClassApproval = toggleStudentLinkApproval;

async function toggleStudentEmailSent(id, emailSent, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/email-sent`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ emailSent })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update email sent state');

    const student = students.find(item => String(item.id) === String(id));
    if (student) {
      student.emailSent = emailSent;
    }
    if (typeof allStudentsMaster !== 'undefined' && Array.isArray(allStudentsMaster)) {
      const master = allStudentsMaster.find(item => String(item.id) === String(id));
      if (master && master !== student) {
        master.emailSent = emailSent;
      }
    }
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');
    showToast(
      emailSent ? 'Email Marked Sent' : 'Email Marked Unsent',
      emailSent ? 'Student marked as email sent.' : 'Email sent status removed for this student.'
    );
  } catch (err) {
    if (button) button.disabled = false;
    await showPopup({ title: 'Could not update email state', message: err.message, danger: true });
  }
}

async function toggleGroupMembership(id, inGroup, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/students/${id}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inGroup, assignedGroup: inGroup ? undefined : '' })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not update group membership');

    const student = students.find(item => String(item.id) === String(id));
    if (student) {
      student.inGroup = inGroup;
      if (!inGroup) student.assignedGroup = '';
    }
    if (typeof allStudentsMaster !== 'undefined' && Array.isArray(allStudentsMaster)) {
      const master = allStudentsMaster.find(item => String(item.id) === String(id));
      if (master && master !== student) {
        master.inGroup = inGroup;
        if (!inGroup) master.assignedGroup = '';
      }
    }
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');
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
      body: JSON.stringify({ inGroup: false, leftGroup: true, assignedGroup: '' })
    });
    const json = await parseApiResponse(response);
    if (!json.success) throw new Error(json.error || 'Could not mark the student as having left');

    const student = students.find(item => String(item.id) === String(id));
    if (student) {
      student.inGroup = false;
      student.leftGroup = true;
      student.assignedGroup = '';
    }
    if (typeof allStudentsMaster !== 'undefined' && Array.isArray(allStudentsMaster)) {
      const master = allStudentsMaster.find(item => String(item.id) === String(id));
      if (master && master !== student) {
        master.inGroup = false;
        master.leftGroup = true;
        master.assignedGroup = '';
      }
    }
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');
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

function showPopup({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', showCancel = false, danger = false, icon }) {
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
  overlay.querySelector('#popupIcon').textContent = icon || (danger ? '!' : 'i');
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
  if (isCurrentUserDeleg()) return;
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
    const res = await fetch(`${API_BASE}/students/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }
    });
    const json = await parseApiResponse(res);
    if (json.success) {
      showToast('Record deleted', 'The student record was removed.');
      allStudentsMaster = allStudentsMaster.filter(s => String(s.id) !== String(id));
      applySectionFilter();
      checkDbConnection();
    } else {
      await showPopup({ title: 'Could not delete record', message: json.error || 'Please try again.', danger: true });
    }
  } catch (err) {
    await showPopup({ title: 'Something went wrong', message: err.message, danger: true });
  }
}

function updateMajorSelectOptions(section, selectedMajor = '') {
  const majorSelect = document.querySelector('#studentMajorSelect');
  if (!majorSelect) return;
  const majors = (section === 'csvt') ? CSVT_MAJORS_LIST : MISPCE_MAJORS_LIST;
  const options = ['<option value="" disabled>Select a major</option>'];
  majors.forEach(m => {
    options.push(`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`);
  });
  majorSelect.innerHTML = options.join('');
  if (selectedMajor && majors.some(m => m.toLowerCase() === selectedMajor.toLowerCase())) {
    majorSelect.value = selectedMajor;
  } else {
    majorSelect.selectedIndex = 0;
  }
  majorSelect._rebuildCustomSelect?.();
}

function initStudentForm() {
  if (!form) return;
  const userRole = getCurrentUserRole();
  const userSec = getCurrentUserSection();
  const isSuper = userRole === 'superadmin' || userSec === 'all';

  const sectionSelect = document.querySelector('#studentSectionSelect');
  const formBadge = document.querySelector('#formBadge');

  if (!isSuper) {
    const assignedSec = (userSec || 'mispce').toLowerCase();
    if (sectionSelect) {
      sectionSelect.innerHTML = `<option value="${assignedSec}" selected>${assignedSec.toUpperCase()}</option>`;
      sectionSelect.value = assignedSec;
      const sectionFieldLabel = document.querySelector('#sectionFieldLabel');
      if (sectionFieldLabel) {
        const titleSpan = sectionFieldLabel.querySelector('span');
        if (titleSpan) titleSpan.innerHTML = `Academic section <small style="color:var(--orange-primary);font-weight:700">(${assignedSec.toUpperCase()})</small>`;
      }
    }
    if (formBadge) {
      formBadge.textContent = `${assignedSec.toUpperCase()} SECTION`;
    }
    updateMajorSelectOptions(assignedSec);
  } else {
    if (sectionSelect) {
      sectionSelect.innerHTML = `
        <option value="mispce" selected>MISPCE</option>
        <option value="csvt">CSVT</option>
      `;
      sectionSelect.value = 'mispce';
      updateMajorSelectOptions('mispce');
      sectionSelect.addEventListener('change', () => {
        updateMajorSelectOptions(sectionSelect.value);
      });
    }
  }
  sectionSelect?._rebuildCustomSelect?.();
}

// Form logic (Add / Edit Student)
if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const required = [...form.querySelectorAll('[required]')];
    required.forEach(input => input.classList.toggle('invalid', !input.validity.valid));
    form.querySelectorAll('.custom-select').forEach(cs => {
      const sel = cs.querySelector('select');
      const trig = cs.querySelector('.custom-select-trigger');
      if (sel && trig) trig.classList.toggle('invalid', !sel.validity.valid);
    });
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

    const token = localStorage.getItem('hub_token') || '';
    const authHeaders = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    try {
      let res, json;
      if (editingId) {
        res = await fetch(`${API_BASE}/students/${editingId}`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(studentData),
        });
      } else {
        res = await fetch(`${API_BASE}/students`, {
          method: 'POST',
          headers: authHeaders,
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
  const formSaveContactBtn = document.querySelector('#formSaveContactBtn');
  if (formSaveContactBtn) {
    formSaveContactBtn.classList.remove('hidden');
    formSaveContactBtn.onclick = () => saveStudentContact(editId);
  }

  try {
    const res = await fetch(`${API_BASE}/students/${editId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }
    });
    const json = await parseApiResponse(res);
    if (json.success && json.data) {
      const student = json.data;
      const userRole = getCurrentUserRole();
      const userSec = getCurrentUserSection();
      const isSuper = userRole === 'superadmin' || userSec === 'all';
      const sec = (student.section || inferSectionFromMajor(student.major) || 'mispce').toLowerCase();
      const sectionSelect = document.querySelector('#studentSectionSelect');
      if (sectionSelect && isSuper) {
        sectionSelect.value = sec;
        sectionSelect._syncCustomSelect?.();
      }
      updateMajorSelectOptions(isSuper ? sec : (userSec || 'mispce'), student.major);

      Object.entries(student).forEach(([key, value]) => {
        if (key === 'section' || key === 'major') return;
        const input = form.querySelector(`[name="${key}"][value="${CSS.escape(value || '')}"]`) || form.querySelector(`[name="${key}"]`);
        if (input) {
          if (input.type === 'radio') {
            input.checked = true;
          } else {
            input.value = value || '';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
      const majorSelect = document.querySelector('#studentMajorSelect');
      if (majorSelect && student.major) {
        majorSelect.value = student.major;
        majorSelect._syncCustomSelect?.();
      }
    }
  } catch (err) {
    console.error('Failed to load student for editing:', err);
  }
}

// Search input listener
if (searchInput) {
  searchInput.addEventListener('input', () => {
    currentStudentPage = 1;
    scheduleRenderStudents(searchInput.value);
  });
}

[statusFilter, classFilter, majorFilter, campusFilter, languageFilter, groupFilter, emailSentFilter].forEach(filter => {
  if (filter) filter.addEventListener('change', () => {
    currentStudentPage = 1;
    scheduleRenderStudents(searchInput?.value || '');
  });
});

if (clearFilters) {
  clearFilters.addEventListener('click', () => {
    currentStudentPage = 1;
    if (searchInput) searchInput.value = '';
    [statusFilter, classFilter, majorFilter, campusFilter, languageFilter, groupFilter, emailSentFilter].forEach(filter => {
      if (filter) {
        filter.value = '';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    scheduleRenderStudents('');
  });
}

// Helper to escape special characters in vCard text fields (RFC 2426)
function escapeVCardValue(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Generate valid vCard 3.0 for iOS / iPhone and Android contact import
function buildVCard(student) {
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
  const sec = (student.section || (typeof inferSectionFromMajor === 'function' ? inferSectionFromMajor(student.major) : '') || '').toUpperCase();
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
  if (student.note && (typeof isCurrentUserDeleg === 'function' ? !isCurrentUserDeleg() : true)) {
    noteParts.push(`Note: ${student.note}`);
  }
  if (noteParts.length) {
    lines.push(`NOTE:${escapeVCardValue(noteParts.join(' | '))}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

// Save student as contact on phone (iOS / iPhone, Android, or desktop)
async function saveStudentContact(studentId) {
  let student = (typeof students !== 'undefined' && students.find(s => String(s.id) === String(studentId)))
    || (typeof allStudentsMaster !== 'undefined' && allStudentsMaster.find(s => String(s.id) === String(studentId)))
    || (typeof fullStudentsCache !== 'undefined' && fullStudentsCache.find(s => String(s.id) === String(studentId)))
    || (typeof records !== 'undefined' && records.find(s => String(s.id) === String(studentId)));

  if (!student) {
    try {
      const res = await fetch(`${API_BASE}/students/${encodeURIComponent(studentId)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` }
      });
      const json = await parseApiResponse(res);
      if (json.success && json.data) {
        student = json.data;
      }
    } catch (err) {
      console.warn('Could not fetch student for contact:', err);
    }
  }

  if (!student) {
    showToast('Not Found', 'Could not locate student details to save contact.');
    return;
  }

  const firstName = (student.firstName || '').trim();
  const fatherName = (student.fatherName || '').trim();
  const familyName = (student.familyName || '').trim();
  const fullName = [firstName, fatherName, familyName].filter(Boolean).join(' ') || 'Student';

  const cleanFirst = firstName.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_') || 'Student';
  const cleanFamily = familyName.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_');
  const filename = `${cleanFirst}${cleanFamily ? '_' + cleanFamily : ''}.vcf`;

  const vcard = buildVCard(student);
  const token = localStorage.getItem('hub_token') || '';

  // Detect iOS (iPhone / iPad / iPod)
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // 1. Try Web Share API (native on iOS Safari & Chrome 15+ and Android)
  // Sharing a File with type 'text/vcard' opens the native iOS Share Sheet with Contacts preview,
  // allowing user to directly tap "Contacts" or "Add to Contacts".
  if (navigator.share && typeof File !== 'undefined') {
    try {
      const file = new File([vcard], filename, { type: 'text/vcard' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fullName
        });
        showToast('Contact Card', `Opened contact for ${fullName}.`);
        return;
      }
    } catch (err) {
      // User tapped cancel on iOS Share Sheet -> do nothing
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('Web Share failed, falling back to download:', err);
    }
  }

  // 2. Direct server URL fallback for iOS Safari:
  // Navigating to a direct .vcf URL on iOS Safari triggers Safari's native QuickLook contact import modal.
  if (isIOS && token && typeof API_BASE !== 'undefined') {
    const vcardUrl = `${API_BASE}/students/${encodeURIComponent(student.id)}/contact.vcf?token=${encodeURIComponent(token)}`;
    window.location.href = vcardUrl;
    showToast('Contact Card', 'Opening contact card for your iPhone…');
    return;
  }

  // 3. Blob download fallback (for desktop, Android, and offline support)
  try {
    const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

    showToast(
      'Contact Saved',
      isIOS
        ? 'Contact downloaded. Tap it in Safari Downloads to add to iPhone Contacts.'
        : `Downloaded ${filename}. Open to save to contacts.`
    );
  } catch (err) {
    console.error('Error generating contact card:', err);
    showToast('Download Error', 'Could not create contact card.');
  }
}

window.buildVCard = buildVCard;
window.saveStudentContact = saveStudentContact;

// Export CSV button listener
const exportBtn = document.querySelector('#exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    if (isCurrentUserDeleg()) return;
    if (!students.length) return showToast('Nothing to export', 'No student records available.');
    const columns = ['firstName','fatherName','familyName','school','address','origin','phone','major','politicalAffiliation','status','language','campus','email','inGroup','assignedGroup'];
    const csv = [columns.join(','), ...students.map(s => columns.map(key => `"${String(s[key] || '').replaceAll('"','""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    link.download = 'student-os-records.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// Each student has one editable note, persisted with their database record.
function setupNotes() {
  if (isCurrentUserDeleg()) return;
  const dialog = document.querySelector('#noteDialog');
  if (!dialog || !recordsGrid) return;
  const noteForm = document.querySelector('#noteForm');
  const input = document.querySelector('#noteText');
  const error = document.querySelector('#noteError');
  const saveButton = noteForm.querySelector('[type="submit"]');
  const cancelButton = document.querySelector('#cancelNoteBtn');
  let studentId = null;
  let saving = false;

  recordsGrid.addEventListener('click', event => {
    const button = event.target.closest('.student-note-button');
    if (!button) return;
    const student = students.find(item => String(item.id) === button.dataset.studentId);
    if (!student) return;
    studentId = student.id;
    input.value = student.note || '';
    error.textContent = '';
    document.querySelector('#noteDialogTitle').textContent = student.note ? 'Edit Note' : 'Add Note';
    document.querySelector('#noteStudentName').textContent = `${student.firstName} ${student.familyName}`;
    dialog.showModal();
    input.focus();
  });
  cancelButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    const button = Array.from(recordsGrid.querySelectorAll('.student-note-button'))
      .find(item => item.dataset.studentId === String(studentId));
    if (button) button.focus();
  });
  noteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    saveButton.disabled = cancelButton.disabled = input.disabled = true;
    saveButton.textContent = 'Saving…';
    error.textContent = '';
    try {
      const response = await fetch(`${API_BASE}/students/${encodeURIComponent(studentId)}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hub_token') || ''}` },
        body: JSON.stringify({ note: input.value.trim() })
      });
      const json = await parseApiResponse(response);
      if (!response.ok || !json.success) throw new Error(json.error || 'Could not save note.');
      const student = students.find(item => item.id === studentId);
      if (student) student.note = json.data.note;
      renderStudents(searchInput ? searchInput.value : '');
      dialog.close();
      showToast('Note saved', 'The note was saved to this student’s record.');
    } catch (err) {
      error.textContent = err.message;
    } finally {
      saving = false;
      saveButton.disabled = cancelButton.disabled = input.disabled = false;
      saveButton.textContent = 'Save Note';
    }
  });
}

// Modern Animated Custom Select Component
function initCustomSelects(scope = document) {
  const selects = scope.querySelectorAll('.form-card select, .student-filters select, select.custom-select-target');
  selects.forEach(select => {
    if (select.dataset.customized === 'true') return;
    select.dataset.customized = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    wrapper.dataset.selectName = select.name || select.id || '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-select-value';

    const chevron = document.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

    trigger.appendChild(valueSpan);
    trigger.appendChild(chevron);

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('tabindex', '-1');

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);
    wrapper.appendChild(select);
    select.classList.add('sr-only-select');

    let ignoreNextTriggerClick = false;

    function sync() {
      const idx = select.selectedIndex >= 0 ? select.selectedIndex : 0;
      const current = select.options[idx];
      if (current) {
        valueSpan.textContent = current.textContent;
        valueSpan.classList.toggle('is-placeholder', !current.value && current.disabled);
      }
      wrapper.classList.toggle('has-value', Boolean(select.value));
      dropdown.querySelectorAll('.custom-select-option').forEach(el => {
        const isSel = el.dataset.index === String(idx);
        el.classList.toggle('is-selected', isSel);
        el.setAttribute('aria-selected', String(isSel));
      });
      trigger.classList.toggle('invalid', select.classList.contains('invalid'));
    }

    function renderOptions() {
      dropdown.innerHTML = '';
      const selectedIndex = select.selectedIndex >= 0 ? select.selectedIndex : 0;
      const currentOption = select.options[selectedIndex];

      if (currentOption) {
        valueSpan.textContent = currentOption.textContent;
        valueSpan.classList.toggle('is-placeholder', !currentOption.value && currentOption.disabled);
      }
      wrapper.classList.toggle('has-value', Boolean(select.value));

      Array.from(select.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-select-option';
        item.dataset.value = opt.value;
        item.dataset.index = String(idx);
        item.setAttribute('role', 'option');

        if (opt.disabled) {
          item.classList.add('is-disabled');
          item.setAttribute('aria-disabled', 'true');
        }
        if (idx === selectedIndex) {
          item.classList.add('is-selected');
          item.setAttribute('aria-selected', 'true');
        }
        if (!opt.value && opt.disabled) {
          item.classList.add('is-placeholder');
        }

        const label = document.createElement('span');
        label.className = 'option-label';
        label.textContent = opt.textContent;
        item.appendChild(label);

        const check = document.createElement('span');
        check.className = 'option-check';
        check.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        item.appendChild(check);

        item.addEventListener('mousedown', e => {
          e.preventDefault();
          e.stopPropagation();
        });

        item.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (opt.disabled) return;
          select.selectedIndex = idx;
          select.value = opt.value;
          select.classList.remove('invalid');
          trigger.classList.remove('invalid');
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));
          sync();
          close(true);
          trigger.focus();
        });

        dropdown.appendChild(item);
      });
    }

    function open() {
      document.querySelectorAll('.custom-select.is-open').forEach(other => {
        if (other !== wrapper) {
          other.classList.remove('is-open');
          other.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });
      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      const selected = dropdown.querySelector('.custom-select-option.is-selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }

    function close(fromSelection = false) {
      wrapper.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (fromSelection) {
        ignoreNextTriggerClick = true;
        setTimeout(() => { ignoreNextTriggerClick = false; }, 300);
      }
    }

    dropdown.addEventListener('mousedown', e => {
      e.stopPropagation();
    });

    dropdown.addEventListener('click', e => {
      e.stopPropagation();
    });

    trigger.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (ignoreNextTriggerClick) {
        ignoreNextTriggerClick = false;
        return;
      }
      if (wrapper.classList.contains('is-open')) {
        close();
      } else {
        open();
      }
    });

    trigger.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        close();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!wrapper.classList.contains('is-open')) {
          open();
          return;
        }
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        let nextIdx = select.selectedIndex + delta;
        while (nextIdx >= 0 && nextIdx < select.options.length && select.options[nextIdx].disabled) {
          nextIdx += delta;
        }
        if (nextIdx >= 0 && nextIdx < select.options.length) {
          select.selectedIndex = nextIdx;
          select.value = select.options[nextIdx].value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));
          sync();
          const targetItem = dropdown.querySelector(`[data-index="${nextIdx}"]`);
          targetItem?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (wrapper.classList.contains('is-open')) {
          close();
        } else {
          open();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
    select.addEventListener('invalid', () => trigger.classList.add('invalid'));
    select.addEventListener('focus', () => trigger.focus());

    select._rebuildCustomSelect = renderOptions;
    select._syncCustomSelect = sync;

    renderOptions();
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.custom-select.is-open').forEach(el => {
      el.classList.remove('is-open');
      el.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  }
});

// --- Superadmin Batch vCard Export & New Student Tracking ---
const STORAGE_KEY_EXPORTED_VCARD_IDS = 'student_os_exported_vcard_ids';
const STORAGE_KEY_LAST_VCARD_EXPORT = 'student_os_last_vcard_export_time';

function getExportedVCardIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXPORTED_VCARD_IDS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (err) {
    console.warn('Error reading exported vCard IDs from storage:', err);
    return new Set();
  }
}

function markStudentsAsExported(ids) {
  if (!ids || !ids.length) return;
  const set = getExportedVCardIds();
  ids.forEach(id => set.add(String(id)));
  try {
    localStorage.setItem(STORAGE_KEY_EXPORTED_VCARD_IDS, JSON.stringify(Array.from(set)));
    localStorage.setItem(STORAGE_KEY_LAST_VCARD_EXPORT, new Date().toISOString());
  } catch (err) {
    console.warn('Error saving exported vCard IDs to storage:', err);
  }
}

function resetExportedVCardHistory() {
  localStorage.removeItem(STORAGE_KEY_EXPORTED_VCARD_IDS);
  localStorage.removeItem(STORAGE_KEY_LAST_VCARD_EXPORT);
  const unexpRadio = document.querySelector('input[name="vcardScopeFilter"][value="unexported"]');
  if (unexpRadio) unexpRadio.checked = true;
  updateVCardExportModalStats();
  showToast('Export history reset', 'All contacts are now marked as unexported.');
}

function getVCardExportStudents() {
  if (Array.isArray(allStudentsMaster) && allStudentsMaster.length) {
    return allStudentsMaster;
  }
  if (Array.isArray(students) && students.length) {
    return students;
  }
  return [];
}

async function openVCardExportModal() {
  const modal = document.querySelector('#vcardExportModal');
  if (!modal) return;

  if (!getVCardExportStudents().length) {
    try {
      await fetchStudents();
    } catch (err) {
      console.warn('Could not prefetch students for vCard export modal:', err);
    }
  }

  const exportedSet = getExportedVCardIds();
  const allList = getVCardExportStudents();
  const statusVal = (document.querySelector('input[name="vcardStatusFilter"]:checked')?.value || 'both').toLowerCase();

  let statusMatching = allList;
  if (statusVal === 'new') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'new');
  } else if (statusVal === 'mu3id') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id');
  }

  const unexportedCount = statusMatching.filter(s => !exportedSet.has(String(s.id))).length;
  const unexpRadio = document.querySelector('input[name="vcardScopeFilter"][value="unexported"]');
  const allRadio = document.querySelector('input[name="vcardScopeFilter"][value="all"]');

  if (unexportedCount > 0) {
    if (unexpRadio) unexpRadio.checked = true;
  } else {
    if (allRadio) allRadio.checked = true;
  }

  updateVCardExportModalStats();
  modal.showModal();
}

function updateVCardExportModalStats() {
  const modal = document.querySelector('#vcardExportModal');
  if (!modal) return;

  const exportedSet = getExportedVCardIds();
  const allList = getVCardExportStudents();

  const statusVal = (document.querySelector('input[name="vcardStatusFilter"]:checked')?.value || 'both').toLowerCase();
  const scopeVal = document.querySelector('input[name="vcardScopeFilter"]:checked')?.value || 'unexported';

  let statusMatching = allList;
  if (statusVal === 'new') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'new');
  } else if (statusVal === 'mu3id') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id');
  }

  const unexportedMatching = statusMatching.filter(s => !exportedSet.has(String(s.id)));
  const totalInStatus = statusMatching.length;
  const unexportedCount = unexportedMatching.length;

  const unexportedTitle = document.querySelector('#vcardUnexportedTitle');
  const unexportedDesc = document.querySelector('#vcardUnexportedDesc');
  const allTitle = document.querySelector('#vcardAllTitle');
  const allDesc = document.querySelector('#vcardAllDesc');

  if (unexportedTitle) {
    unexportedTitle.textContent = `Only new / unexported students (${unexportedCount})`;
  }
  if (allTitle) {
    allTitle.textContent = `All matching students (${totalInStatus})`;
  }

  if (unexportedDesc) {
    if (unexportedCount === 0 && totalInStatus > 0) {
      unexportedDesc.textContent = `All ${totalInStatus} students were already exported. Select "All matching" to re-export.`;
    } else if (totalInStatus === 0) {
      unexportedDesc.textContent = 'No students match the selected status filter.';
    } else {
      unexportedDesc.textContent = `${unexportedCount} student${unexportedCount === 1 ? '' : 's'} added since your last export`;
    }
  }

  if (allDesc) {
    allDesc.textContent = totalInStatus > 0
      ? `Re-export all ${totalInStatus} contact${totalInStatus === 1 ? '' : 's'}`
      : 'No students match the selected status filter';
  }

  const targetList = scopeVal === 'unexported' ? unexportedMatching : statusMatching;
  const exportCount = targetList.length;

  const countEl = document.querySelector('#vcardExportCount');
  if (countEl) {
    countEl.textContent = `${exportCount} contact${exportCount === 1 ? '' : 's'}`;
  }

  const breakdownEl = document.querySelector('#vcardStatusBreakdown');
  if (breakdownEl) {
    const newCount = targetList.filter(s => String(s.status || '').trim().toLowerCase() === 'new').length;
    const mu3idCount = targetList.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id').length;
    breakdownEl.textContent = `New: ${newCount} • Mu3id: ${mu3idCount}`;
  }

  const lastExportEl = document.querySelector('#vcardLastExportInfo');
  if (lastExportEl) {
    const lastIso = localStorage.getItem(STORAGE_KEY_LAST_VCARD_EXPORT);
    if (lastIso) {
      try {
        const d = new Date(lastIso);
        lastExportEl.textContent = `Last exported: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } catch {
        lastExportEl.textContent = 'Last exported: Previously';
      }
    } else {
      lastExportEl.textContent = 'Last exported: Never';
    }
  }

  const confirmBtn = document.querySelector('#confirmVCardExportBtn');
  if (confirmBtn) {
    confirmBtn.disabled = exportCount === 0;
  }
}

async function executeVCardExport() {
  const confirmBtn = document.querySelector('#confirmVCardExportBtn');
  const btnText = document.querySelector('#confirmVCardBtnText');
  const modal = document.querySelector('#vcardExportModal');
  const originalHtml = btnText ? btnText.textContent : 'Export vCard';

  const exportedSet = getExportedVCardIds();
  const allList = getVCardExportStudents();

  const statusVal = (document.querySelector('input[name="vcardStatusFilter"]:checked')?.value || 'both');
  const scopeVal = document.querySelector('input[name="vcardScopeFilter"]:checked')?.value || 'unexported';

  let statusMatching = allList;
  if (statusVal.toLowerCase() === 'new') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'new');
  } else if (statusVal.toLowerCase() === 'mu3id') {
    statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id');
  }

  const targetList = scopeVal === 'unexported'
    ? statusMatching.filter(s => !exportedSet.has(String(s.id)))
    : statusMatching;

  if (!targetList.length) {
    showToast('Nothing to export', 'No matching contacts found to export.');
    return;
  }

  const targetIds = targetList.map(s => s.id);

  try {
    if (confirmBtn) confirmBtn.disabled = true;
    if (btnText) btnText.textContent = 'Generating…';

    const token = localStorage.getItem('hub_token') || '';
    const queryParams = new URLSearchParams({
      status: statusVal,
      ids: targetIds.join(',')
    });

    const res = await fetch(`${API_BASE}/students/export/vcard?${queryParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const errJson = await parseApiResponse(res);
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const vcfText = await res.text();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `students_vcard_${statusVal.toLowerCase()}_${targetIds.length}_${dateStr}.vcf`;

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    let shared = false;
    if (navigator.share && typeof File !== 'undefined') {
      try {
        const file = new File([vcfText], filename, { type: 'text/vcard' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Student Contacts (${targetIds.length})`
          });
          shared = true;
        }
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') {
          if (confirmBtn) confirmBtn.disabled = false;
          if (btnText) btnText.textContent = originalHtml;
          return;
        }
        console.warn('navigator.share failed, using direct download fallback:', shareErr);
      }
    }

    if (!shared) {
      const blob = new Blob([vcfText], { type: 'text/vcard;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
    }

    markStudentsAsExported(targetIds);

    if (modal) modal.close();

    showToast(
      'Export Complete',
      isIOS
        ? `Exported ${targetIds.length} contact${targetIds.length === 1 ? '' : 's'}. Tap download in Safari to add to Contacts.`
        : `Exported ${targetIds.length} contact${targetIds.length === 1 ? '' : 's'} as vCard.`
    );
  } catch (err) {
    console.error('Error exporting vCards:', err);
    showToast('Export Failed', err.message || 'Could not export student vCards.');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
    if (btnText) btnText.textContent = originalHtml;
  }
}

function setupVCardExportUI() {
  const isSuperAdmin = getCurrentUserRole() === 'superadmin';
  document.querySelectorAll('.export-vcard-trigger-btn').forEach(el => {
    el.style.display = isSuperAdmin ? '' : 'none';
    el.addEventListener('click', () => {
      if (getCurrentUserRole() !== 'superadmin') return;
      openVCardExportModal();
    });
  });

  const modal = document.querySelector('#vcardExportModal');
  if (!modal) return;

  const closeBtn = document.querySelector('#closeVCardExportModal');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.close());

  const cancelBtn = document.querySelector('#cancelVCardExportBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.close());

  document.querySelectorAll('input[name="vcardStatusFilter"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const exportedSet = getExportedVCardIds();
      const allList = getVCardExportStudents();
      const statusVal = (radio.value || 'both').toLowerCase();
      let statusMatching = allList;
      if (statusVal === 'new') {
        statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'new');
      } else if (statusVal === 'mu3id') {
        statusMatching = allList.filter(s => String(s.status || '').trim().toLowerCase() === 'mu3id');
      }
      const unexportedCount = statusMatching.filter(s => !exportedSet.has(String(s.id))).length;
      const unexpRadio = document.querySelector('input[name="vcardScopeFilter"][value="unexported"]');
      const allRadio = document.querySelector('input[name="vcardScopeFilter"][value="all"]');
      if (unexportedCount > 0) {
        if (unexpRadio) unexpRadio.checked = true;
      } else {
        if (allRadio) allRadio.checked = true;
      }
      updateVCardExportModalStats();
    });
  });

  document.querySelectorAll('input[name="vcardScopeFilter"]').forEach(radio => {
    radio.addEventListener('change', updateVCardExportModalStats);
  });

  const resetBtn = document.querySelector('#vcardResetHistoryBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetExportedVCardHistory);
  }

  const confirmBtn = document.querySelector('#confirmVCardExportBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', executeVCardExport);
  }
}

/* ==========================================================================
   Email Group Invitation System (Frontend Controller)
   ========================================================================== */

let emailModalState = {
  mode: 'single', // 'single' | 'bulk'
  studentId: null,
  student: null,
  scope: 'not_in_group', // 'not_in_group' | 'filtered' | 'all'
  previewDebounceTimer: null,
  isSending: false
};

const EMAIL_STORAGE_LAST_LINK = 'ulfs2_email_last_link';
const EMAIL_STORAGE_PRESETS = 'ulfs2_email_preset_links';
const EMAIL_STORAGE_CUSTOM_NOTE = 'ulfs2_email_last_note';

function getStoredGroupPresets() {
  try {
    return JSON.parse(localStorage.getItem(EMAIL_STORAGE_PRESETS) || '{}');
  } catch {
    return {};
  }
}

function saveGroupPreset(key, url) {
  if (!url) return;
  try {
    const presets = getStoredGroupPresets();
    if (key) presets[key] = url;
    localStorage.setItem(EMAIL_STORAGE_PRESETS, JSON.stringify(presets));
    localStorage.setItem(EMAIL_STORAGE_LAST_LINK, url);
  } catch {}
}

function getBestGroupUrl(groupKey) {
  const presets = getStoredGroupPresets();
  if (groupKey && presets[groupKey]) return presets[groupKey];
  return localStorage.getItem(EMAIL_STORAGE_LAST_LINK) || '';
}

function getRecipientPool() {
  if (Array.isArray(allStudentsMaster) && allStudentsMaster.length) {
    return allStudentsMaster;
  }
  return Array.isArray(students) ? students : [];
}

async function checkEmailServiceStatus() {
  const banner = document.querySelector('#emailMailerStatusBanner');
  const textEl = document.querySelector('#emailMailerStatusText');
  if (!banner || !textEl) return;

  try {
    const res = await fetch(`${API_BASE}/email/status`, {
      headers: { 'Authorization': `Bearer ${getAuthToken()}` }
    });
    const data = await parseApiResponse(res);
    if (data && data.configured) {
      banner.className = 'mailer-status-banner is-active';
      textEl.textContent = `Ready: Real email delivery active via ${data.host || 'SMTP'}`;
    } else {
      banner.className = 'mailer-status-banner is-test';
      textEl.textContent = 'Development/Test Mode: Emails will be simulated with instant preview links (Configure SMTP in .env for production).';
    }
  } catch {
    banner.className = 'mailer-status-banner';
    textEl.textContent = 'Mail service ready (standard invitation mode)';
  }
}

function getFilteredStudentsList() {
  const needle = (searchInput?.value || '').trim().toLowerCase();
  const tokens = needle ? needle.split(/\s+/).filter(Boolean) : [];
  const pool = getRecipientPool();

  return pool.filter(student => {
    const nameCombinations = [
      `${student.firstName || ''} ${student.familyName || ''}`,
      `${student.firstName || ''} ${student.fatherName || ''} ${student.familyName || ''}`
    ];
    const isAmchitStudent = (student.campus || '').toLowerCase().includes('am') || (student.assignedGroup || '').toLowerCase().includes('am');
    const campusAliases = isAmchitStudent ? 'amchit amshit' : '';
    const fullSearchText = [...nameCombinations, ...Object.values(student), campusAliases].map(v => String(v || '').toLowerCase()).join(' ');
    const matchesSearch = !tokens.length || tokens.every(token => fullSearchText.includes(token));
    const matchesStatus = !statusFilter?.value || String(student.status || '').trim().toLowerCase() === statusFilter.value.trim().toLowerCase();
    const isApproved = Boolean(student.linkApproved !== undefined ? student.linkApproved : student.inClass);
    const matchesLink = !linkFilter?.value || (linkFilter.value === 'approved' || linkFilter.value === 'in' ? isApproved : !isApproved);
    const matchesEmailSent = !emailSentFilter?.value
      || (emailSentFilter.value === 'sent' ? Boolean(student.emailSent) : !Boolean(student.emailSent));
    const matchesMajor = !majorFilter?.value || student.major === majorFilter.value;
    const targetCampus = (campusFilter?.value || '').trim().toLowerCase();
    const studentCampus = (student.campus || '').trim().toLowerCase();
    const matchesCampus = !targetCampus ||
      (targetCampus.includes('am') ? studentCampus.includes('am') : studentCampus === targetCampus);
    const matchesLanguage = !languageFilter?.value || student.language === languageFilter.value;
    const assignedGroup = getStudentAssignedGroup(student);
    const matchesGroup = !groupFilter?.value
      || (groupFilter.value === 'in' ? (student.inGroup && !student.leftGroup)
        : groupFilter.value === 'out' ? (!student.inGroup && !student.leftGroup)
        : groupFilter.value === 'left' ? Boolean(student.leftGroup)
        : groupFilter.value === 'unassigned' ? (!assignedGroup && !student.leftGroup)
        : groupFilter.value === assignedGroup);
    return matchesSearch && matchesStatus && matchesLink && matchesEmailSent && matchesMajor && matchesCampus && matchesLanguage && matchesGroup;
  });
}

function updateEmailRecipientDisplay() {
  const singleBox = document.querySelector('#emailSingleRecipientBox');
  const bulkBox = document.querySelector('#emailBulkScopeBox');
  const switchBtn = document.querySelector('#emailSwitchScopeBtn');
  const mailtoBtn = document.querySelector('#emailMailtoBtn');

  const pool = getRecipientPool();
  const notInGroupCount = pool.filter(s => !s.inGroup && !s.leftGroup && s.email).length;
  const filteredCount = getFilteredStudentsList().filter(s => s.email).length;
  const allCount = pool.filter(s => s.email).length;

  const countNotInEl = document.querySelector('#emailScopeNotInGroupCount');
  const countFilteredEl = document.querySelector('#emailScopeFilteredCount');
  const countAllEl = document.querySelector('#emailScopeAllCount');
  if (countNotInEl) countNotInEl.textContent = `${notInGroupCount} students with email`;
  if (countFilteredEl) countFilteredEl.textContent = `${filteredCount} students with email`;
  if (countAllEl) countAllEl.textContent = `${allCount} students with email`;

  if (emailModalState.mode === 'single' && emailModalState.student) {
    if (singleBox) singleBox.style.display = 'flex';
    if (bulkBox) bulkBox.style.display = 'none';
    if (switchBtn) switchBtn.style.display = 'inline-block';
    if (switchBtn) switchBtn.textContent = 'Switch to bulk send';
    if (mailtoBtn) mailtoBtn.style.display = 'inline-flex';

    const s = emailModalState.student;
    const fullName = `${s.firstName || ''} ${s.fatherName || ''} ${s.familyName || ''}`.trim() || 'Student';
    const initials = `${s.firstName?.[0] || ''}${s.familyName?.[0] || ''}`.toUpperCase() || 'ST';
    const avatar = document.querySelector('#emailRecipientAvatar');
    const nameEl = document.querySelector('#emailRecipientName');
    const emailEl = document.querySelector('#emailRecipientEmail');
    const metaEl = document.querySelector('#emailRecipientMeta');

    if (avatar) avatar.textContent = initials;
    if (nameEl) nameEl.textContent = fullName;
    if (emailEl) emailEl.textContent = s.email || 'No email provided';
    if (metaEl) metaEl.textContent = `${s.major || ''} • ${(s.section || inferSectionFromMajor(s.major) || 'MISPCE').toUpperCase()} • ${getStudentAssignedGroup(s) || 'General Group'}`;
  } else {
    if (singleBox) singleBox.style.display = 'none';
    if (bulkBox) bulkBox.style.display = 'flex';
    if (switchBtn) switchBtn.style.display = 'none';
    if (mailtoBtn) mailtoBtn.style.display = 'none';
  }
}

function updateEmailTemplatePreview() {
  clearTimeout(emailModalState.previewDebounceTimer);
  emailModalState.previewDebounceTimer = setTimeout(async () => {
    const frame = document.querySelector('#emailPreviewFrame');
    if (!frame) return;

    const groupNameInput = document.querySelector('#emailGroupNameInput');
    const joinUrlInput = document.querySelector('#emailJoinUrlInput');
    const customNoteInput = document.querySelector('#emailCustomNoteInput');

    let sampleStudent = emailModalState.student;
    if (!sampleStudent) {
      const pool = getRecipientPool();
      if (emailModalState.scope === 'filtered') {
        sampleStudent = getFilteredStudentsList().find(s => s.email) || pool[0];
      } else {
        sampleStudent = pool.find(s => !s.inGroup && !s.leftGroup && s.email) || pool[0];
      }
    }

    const payload = {
      student: sampleStudent || {
        firstName: 'Carla',
        fatherName: 'Joseph',
        familyName: 'Khoury',
        major: 'Informatics',
        section: 'mispce',
        assignedGroup: 'Grp A',
        campus: 'Fanar',
        status: 'New',
        email: 'carla.khoury@example.com'
      },
      groupName: groupNameInput?.value.trim() || '',
      joinUrl: joinUrlInput?.value.trim() || 'https://chat.whatsapp.com/',
      customMessage: customNoteInput?.value.trim() || ''
    };

    try {
      const res = await fetch(`${API_BASE}/email/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(res);
      if (data && data.success && data.html) {
        frame.srcdoc = data.html;
        updateEmailMailtoFallback(data.subject, data.text);
      }
    } catch (e) {
      console.warn('Could not fetch email preview:', e);
    }
  }, 120);
}

function updateEmailMailtoFallback(subject, textBody) {
  const mailtoBtn = document.querySelector('#emailMailtoBtn');
  if (!mailtoBtn) return;
  const student = emailModalState.student;
  if (!student || !student.email) {
    mailtoBtn.style.display = 'none';
    return;
  }
  const mailtoUrl = `mailto:${encodeURIComponent(student.email)}?subject=${encodeURIComponent(subject || 'Class Group Invitation')}&body=${encodeURIComponent(textBody || '')}`;
  mailtoBtn.href = mailtoUrl;
}

function openEmailModalForStudent(studentId) {
  const pool = getRecipientPool();
  const student = pool.find(s => String(s.id) === String(studentId));
  if (!student) {
    showToast('Student not found', 'Could not locate the requested student record.');
    return;
  }

  if (!student.email || !String(student.email).trim().includes('@')) {
    showPopup({
      title: 'Email Address Missing',
      message: `${student.firstName} ${student.familyName} does not have an email address recorded. Please add an email address in "Edit Record" first before sending an invitation.`,
      danger: false
    });
    return;
  }

  emailModalState.mode = 'single';
  emailModalState.studentId = student.id;
  emailModalState.student = student;

  const modal = document.querySelector('#emailInviteModal');
  if (!modal) return;

  const assigned = getStudentAssignedGroup(student);
  const sec = (student.section || inferSectionFromMajor(student.major) || 'MISPCE').toUpperCase();
  const suggestedTitle = `ULFS2 ${student.major || ''} (${sec}) — ${assigned || 'Class Group'}`;

  const groupNameInput = document.querySelector('#emailGroupNameInput');
  const joinUrlInput = document.querySelector('#emailJoinUrlInput');
  const customNoteInput = document.querySelector('#emailCustomNoteInput');

  if (groupNameInput) groupNameInput.value = suggestedTitle;
  if (joinUrlInput) joinUrlInput.value = getBestGroupUrl(assigned) || '';
  if (customNoteInput) customNoteInput.value = localStorage.getItem(EMAIL_STORAGE_CUSTOM_NOTE) || '';

  // Update chip highlights
  document.querySelectorAll('.group-preset-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.preset === assigned);
  });

  updateEmailRecipientDisplay();
  checkEmailServiceStatus();
  updateEmailTemplatePreview();

  modal.showModal();
}

const automaticEmailSends = new Set();

async function sendStudentEmailAutomatically(studentId, button) {
  const id = String(studentId);
  if (automaticEmailSends.has(id)) return;

  const pool = getRecipientPool();
  const student = pool.find(item => String(item.id) === id);
  if (!student) {
    showToast('Email Not Sent', 'Could not locate the student record.');
    return;
  }
  if (!student.email || !String(student.email).trim().includes('@')) {
    showToast('Email Not Sent', 'This student does not have a valid email address.');
    return;
  }

  automaticEmailSends.add(id);
  const originalHtml = button?.innerHTML || '';
  if (button) {
    button.disabled = true;
    button.classList.add('is-sending');
    button.textContent = 'Sending…';
  }

  try {
    const response = await fetch(`${API_BASE}/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({
        studentId: student.id,
        automatic: true,
        markApproved: true
      })
    });
    const data = await parseApiResponse(response);
    if (!data.success || data.sentCount !== 1) {
      throw new Error(data.results?.[0]?.error || data.error || 'Could not send the invitation email.');
    }

    for (const list of [students, allStudentsMaster]) {
      if (!Array.isArray(list)) continue;
      const record = list.find(item => String(item.id) === id);
      if (record) {
        record.linkApproved = true;
        record.inClass = true;
        record.emailSent = true;
      }
    }
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');

    const groupLabel = data.results?.[0]?.groupKey;
    showToast(
      data.simulated ? 'Email Prepared' : 'Email Sent',
      `Invitation sent to ${student.firstName || 'student'}${groupLabel ? ` using the ${groupLabel} link` : ''}.`
    );
  } catch (err) {
    showToast('Email Not Sent', err.message || 'Could not send the invitation email.');
  } finally {
    automaticEmailSends.delete(id);
    if (button?.isConnected) {
      button.disabled = false;
      button.classList.remove('is-sending');
      button.innerHTML = originalHtml;
    }
  }
}

function openGroupEmailModal() {
  emailModalState.mode = 'bulk';
  emailModalState.studentId = null;
  emailModalState.student = null;
  emailModalState.scope = 'not_in_group';

  const modal = document.querySelector('#emailInviteModal');
  if (!modal) return;

  const groupNameInput = document.querySelector('#emailGroupNameInput');
  const joinUrlInput = document.querySelector('#emailJoinUrlInput');
  const customNoteInput = document.querySelector('#emailCustomNoteInput');

  if (groupNameInput) groupNameInput.value = 'ULFS2 Official Class Group';
  if (joinUrlInput) joinUrlInput.value = getBestGroupUrl('General') || '';
  if (customNoteInput) customNoteInput.value = localStorage.getItem(EMAIL_STORAGE_CUSTOM_NOTE) || '';

  const scopeRadio = document.querySelector('input[name="emailScopeOption"][value="not_in_group"]');
  if (scopeRadio) scopeRadio.checked = true;

  updateEmailRecipientDisplay();
  checkEmailServiceStatus();
  updateEmailTemplatePreview();

  modal.showModal();
}

async function executeSendGroupEmail() {
  if (emailModalState.isSending) return;

  const joinUrlInput = document.querySelector('#emailJoinUrlInput');
  const groupNameInput = document.querySelector('#emailGroupNameInput');
  const customNoteInput = document.querySelector('#emailCustomNoteInput');
  const markApprovedCheck = document.querySelector('#emailMarkApprovedCheck');
  const confirmBtn = document.querySelector('#confirmSendEmailBtn');
  const btnText = document.querySelector('#confirmSendEmailBtnText');
  const modal = document.querySelector('#emailInviteModal');

  const joinUrl = (joinUrlInput?.value || '').trim();
  if (!joinUrl) {
    joinUrlInput?.focus();
    showToast('Missing Invitation Link', 'Please enter a group invitation link (e.g. WhatsApp group link).');
    return;
  }

  // Save link to storage for future reuse
  const assigned = emailModalState.student ? getStudentAssignedGroup(emailModalState.student) : null;
  saveGroupPreset(assigned || 'General', joinUrl);
  if (customNoteInput?.value) {
    try { localStorage.setItem(EMAIL_STORAGE_CUSTOM_NOTE, customNoteInput.value.trim()); } catch {}
  }

  // Resolve target student IDs
  let targetIds = [];
  const pool = getRecipientPool();

  if (emailModalState.mode === 'single' && emailModalState.studentId) {
    targetIds = [emailModalState.studentId];
  } else {
    const scope = document.querySelector('input[name="emailScopeOption"]:checked')?.value || 'not_in_group';
    if (scope === 'not_in_group') {
      targetIds = pool.filter(s => !s.inGroup && !s.leftGroup && s.email).map(s => s.id);
    } else if (scope === 'filtered') {
      targetIds = getFilteredStudentsList().filter(s => s.email).map(s => s.id);
    } else {
      targetIds = pool.filter(s => s.email).map(s => s.id);
    }
  }

  if (!targetIds.length) {
    showToast('No Recipients', 'No students with valid email addresses match the selected criteria.');
    return;
  }

  if (targetIds.length > 1) {
    const confirmed = window.confirm(`Are you sure you want to send the group invitation email to ${targetIds.length} students?`);
    if (!confirmed) return;
  }

  // Set sending state
  emailModalState.isSending = true;
  if (confirmBtn) confirmBtn.disabled = true;
  if (btnText) btnText.textContent = targetIds.length > 1 ? `Sending (${targetIds.length})...` : 'Sending...';

  try {
    const res = await fetch(`${API_BASE}/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({
        studentIds: targetIds,
        groupName: groupNameInput?.value.trim() || '',
        joinUrl,
        customMessage: customNoteInput?.value.trim() || '',
        markApproved: markApprovedCheck ? markApprovedCheck.checked : true
      })
    });

    const data = await parseApiResponse(res);
    if (!data.success && data.sentCount === 0) {
      throw new Error(data.error || 'Failed to send invitation emails');
    }

    // Update emailSent and link approval in local memory
    targetIds.forEach(id => {
      const student = students.find(s => String(s.id) === String(id));
      if (student) {
        student.emailSent = true;
        if (markApprovedCheck?.checked) {
          student.linkApproved = true;
          student.inClass = true;
        }
      }
      if (Array.isArray(allStudentsMaster)) {
        const master = allStudentsMaster.find(s => String(s.id) === String(id));
        if (master) {
          master.emailSent = true;
          if (markApprovedCheck?.checked) {
            master.linkApproved = true;
            master.inClass = true;
          }
        }
      }
    });
    updateStats();
    scheduleRenderStudents(searchInput ? searchInput.value : '');

    if (modal) modal.close();

    const toastTitle = data.simulated ? 'Invitation Email Prepared (Test Mode)' : 'Email Sent Successfully';
    let toastDesc = data.message || `Successfully sent ${data.sentCount} invitation email(s).`;
    if (data.previewUrl) {
      toastDesc += ` Click to view preview on Ethereal.`;
    }
    showToast(toastTitle, toastDesc);

    if (data.previewUrl) {
      setTimeout(() => {
        if (window.confirm(`Email sent in test mode. Would you like to view the rendered invitation in your browser?\n\n${data.previewUrl}`)) {
          window.open(data.previewUrl, '_blank');
        }
      }, 400);
    }
  } catch (err) {
    showPopup({
      title: 'Email Delivery Error',
      message: err.message || 'Could not deliver group invitation emails.',
      danger: true
    });
  } finally {
    emailModalState.isSending = false;
    if (confirmBtn) confirmBtn.disabled = false;
    if (btnText) btnText.textContent = 'Send Email';
  }
}

function setupEmailInviteUI() {
  const triggerBtn = document.querySelector('#openGroupEmailModalBtn');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', openGroupEmailModal);
  }

  const modal = document.querySelector('#emailInviteModal');
  if (!modal) return;

  const closeBtn = document.querySelector('#closeEmailInviteModal');
  if (closeBtn) closeBtn.addEventListener('click', () => modal.close());

  const cancelBtn = document.querySelector('#cancelEmailInviteBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.close());

  const confirmBtn = document.querySelector('#confirmSendEmailBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', executeSendGroupEmail);

  // Switch to bulk from single
  const switchBtn = document.querySelector('#emailSwitchScopeBtn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      emailModalState.mode = 'bulk';
      emailModalState.studentId = null;
      emailModalState.student = null;
      updateEmailRecipientDisplay();
      updateEmailTemplatePreview();
    });
  }

  // Preset chips
  document.querySelectorAll('.group-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.group-preset-chip').forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      const preset = chip.dataset.preset;
      const joinUrlInput = document.querySelector('#emailJoinUrlInput');
      const groupNameInput = document.querySelector('#emailGroupNameInput');
      if (preset && joinUrlInput) {
        const saved = getBestGroupUrl(preset);
        if (saved) joinUrlInput.value = saved;
        if (groupNameInput && emailModalState.student) {
          const s = emailModalState.student;
          const sec = (s.section || inferSectionFromMajor(s.major) || 'MISPCE').toUpperCase();
          groupNameInput.value = `ULFS2 ${s.major || ''} (${sec}) — ${preset}`;
        }
        updateEmailTemplatePreview();
      }
    });
  });

  // Inputs live preview debouncing
  ['#emailGroupNameInput', '#emailJoinUrlInput', '#emailCustomNoteInput'].forEach(selector => {
    const input = document.querySelector(selector);
    if (input) {
      input.addEventListener('input', updateEmailTemplatePreview);
    }
  });

  // Radio scopes
  document.querySelectorAll('input[name="emailScopeOption"]').forEach(radio => {
    radio.addEventListener('change', () => {
      emailModalState.scope = radio.value;
      updateEmailTemplatePreview();
    });
  });

  // Device switcher
  const desktopBtn = document.querySelector('#previewModeDesktop');
  const mobileBtn = document.querySelector('#previewModeMobile');
  const previewCol = document.querySelector('.email-dialog-preview');
  if (desktopBtn && mobileBtn && previewCol) {
    desktopBtn.addEventListener('click', () => {
      desktopBtn.classList.add('is-active');
      mobileBtn.classList.remove('is-active');
      previewCol.classList.remove('is-mobile');
    });
    mobileBtn.addEventListener('click', () => {
      mobileBtn.classList.add('is-active');
      desktopBtn.classList.remove('is-active');
      previewCol.classList.add('is-mobile');
    });
  }
}

// Page Initialization
document.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();
  if (!checkAuth()) return;
  initStudentForm();
  initCustomSelects();
  setupNotes();
  setupPoliticalTabs();
  setupClassStatClicks();
  setupSectionSwitchTabs();
  setupVCardExportUI();
  setupEmailInviteUI();
  if (document.body.dataset.page === 'login') return;
  checkDbConnection();
  if (document.body.dataset.page !== 'kazaa') fetchStudents();
  loadPendingUsers();
  loadAllUsers();
  loadBackupStatus();
  initFormEditMode();
  // Periodically re-verify DB connection status
  setInterval(checkDbConnection, 15000);
});
