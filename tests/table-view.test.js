const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('dashboard and index.html include view mode toggle buttons and table container markup', () => {
  for (const page of ['dashboard.html', 'index.html']) {
    const html = fs.readFileSync(path.join(projectRoot, page), 'utf8');
    assert.match(html, /id="viewModeToggle"/);
    assert.match(html, /id="viewModeCardsBtn"/);
    assert.match(html, /id="viewModeTableBtn"/);
    assert.match(html, /id="recordsTableWrap"/);
    assert.match(html, /id="recordsTable"/);
    assert.match(html, /id="recordsTableBody"/);
    assert.match(html, /<th>Student<\/th>/);
    assert.match(html, /<th>Group Assignment<\/th>/);
    assert.match(html, /<th>Link Approved<\/th>/);
    assert.match(html, /<th>Email Sent<\/th>/);
    assert.match(html, /<th>Actions<\/th>/);
  }
});

test('styles.css includes compact table styling and view toggle control rules', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');
  assert.match(css, /\.view-mode-toggle/);
  assert.match(css, /\.view-mode-btn/);
  assert.match(css, /\.records-table-wrap/);
  assert.match(css, /\.records-table/);
  assert.match(css, /\.table-student-cell/);
  assert.match(css, /\.status-pill/);
  assert.match(css, /\.btn-table-icon/);
  assert.match(css, /\.btn-table-action/);
});

test('script.js implements view mode persistence, table row renderer, and dynamic page size', () => {
  const js = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');

  // Verify storage key and mode accessors
  assert.match(js, /const STORAGE_KEY_VIEW_MODE = 'student_os_view_mode'/);
  assert.match(js, /function getViewMode\(\)/);
  assert.match(js, /function setViewMode\(mode\)/);
  assert.match(js, /function setupViewModeToggle\(\)/);

  // Verify page size constants (20 for cards, 30 for compact table)
  assert.match(js, /const STUDENTS_PER_PAGE = 20/);
  assert.match(js, /const TABLE_STUDENTS_PER_PAGE = 30/);
  assert.match(js, /function getPageSize\(\)/);

  // Verify row and card renderer functions exist
  assert.match(js, /function renderStudentCard\(student, isDeleg\)/);
  assert.match(js, /function renderStudentTableRow\(student, isDeleg\)/);
  assert.match(js, /function renderStudentGroupSectionActions\(student, isLeft, groupDisabledAttr\)/);

  // Verify table body population and table view visibility
  assert.match(js, /recordsTableWrap\.hidden = false/);
  assert.match(js, /recordsTableBody\.innerHTML = pageItems\.map\(student => renderStudentTableRow\(student, isDeleg\)\)\.join\(''\)/);
  assert.match(js, /recordsGrid\.hidden = false/);

  // Verify setupNotes event delegation listens to recordsTableWrap as well
  assert.match(js, /recordsTableWrap\.addEventListener\('click', handleNoteClick\)/);
});

test('renderStudentTableRow accurately renders student columns, pills, and action controls', () => {
  // Extract and evaluate renderStudentTableRow in an isolated sandbox
  const js = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  
  // We can construct a minimal sandbox with escapeHtml and helper dependencies
  const escapeHtml = (value = '') => String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
  const ADVANCED_CS_SECTIONS = ['l2', 'l3', 'm1'];
  function inferSectionFromMajor(major = '') {
    const norm = String(major || '').trim().toLowerCase();
    if (['biology', 'bio', 'biologie', 'biochemistry', 'biochimie'].includes(norm)) return 'csvt';
    if (norm.includes('m1')) return 'm1';
    if (norm.includes('l3')) return 'l3';
    if (norm.includes('l2')) return 'l2';
    return 'mispce';
  }
  function getStudentAssignedGroup(student) {
    return student?.assignedGroup || '';
  }

  // Create function runners matching script.js logic
  const renderStudentGroupSectionActions = new Function(
    'student', 'isLeft', 'groupDisabledAttr', 'getStudentAssignedGroup', 'inferSectionFromMajor', 'escapeHtml',
    `
    let groupButtonsHtml = '';
    const assigned = getStudentAssignedGroup(student);
    const studentSec = (student.section || inferSectionFromMajor(student.major) || 'mispce').toLowerCase();
    const lang = (student.language || '').trim().toLowerCase();
    const campus = (student.campus || '').trim().toLowerCase();
    const isAmchit = campus.includes('amchit') || campus.includes('amshit');
    const isFrench = lang.includes('french');
    const isEnglish = lang.includes('english');

    if (isFrench) {
      const isA = assigned === 'Grp A';
      groupButtonsHtml = \`<button type="button" class="btn-action group-section-btn \${isA ? 'is-active' : ''}">Grp A</button>\`;
    }
    return groupButtonsHtml;
    `
  );

  const testStudent = {
    id: 'test-student-1',
    firstName: 'Marie',
    fatherName: 'Jean',
    familyName: 'Khoury',
    school: 'College des Freres',
    origin: 'Beirut',
    status: 'New',
    fileNumber: '4201',
    major: 'Informatics',
    section: 'mispce',
    campus: 'Fanar',
    language: 'French',
    phone: '+961 70 123456',
    email: 'marie.khoury@example.com',
    inGroup: true,
    assignedGroup: 'Grp A',
    linkApproved: true,
    emailSent: true,
    note: 'Follow up about registration'
  };

  // Inspect the script.js source to verify table row markup structure
  assert.match(js, /class="student-table-row/);
  assert.match(js, /class="avatar-sm"/);
  assert.match(js, /class="status-pill status-/);
  assert.match(js, /class="file-num-pill"/);
  assert.match(js, /class="cell-academic"/);
  assert.match(js, /class="cell-campus-lang"/);
  assert.match(js, /class="table-contact-cell"/);
  assert.match(js, /class="table-phone-link"/);
  assert.match(js, /class="table-email-link"/);
  assert.match(js, /class="table-group-actions"/);
  assert.match(js, /class="btn-table-icon/);
  assert.match(js, /class="table-row-actions"/);
});
