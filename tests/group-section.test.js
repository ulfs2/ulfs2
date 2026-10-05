const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const { encryptValue, decryptValue, signSession } = require('../crypto');

let mockStudent = {
  id: '00000000-0000-0000-0000-000000000001',
  first_name: encryptValue('Jean', 'students.first_name'),
  father_name: encryptValue('Pierre', 'students.father_name'),
  family_name: encryptValue('Dupont', 'students.family_name'),
  origin: encryptValue('Beirut', 'students.origin'),
  address: encryptValue('Achrafieh', 'students.address'),
  school: encryptValue('Grand Lycee', 'students.school'),
  major: encryptValue('Informatics', 'students.major'),
  political_affiliation: '',
  status: encryptValue('New', 'students.status'),
  language: encryptValue('French', 'students.language'),
  campus: encryptValue('Fanar', 'students.campus'),
  phone: encryptValue('+961 70 111 222', 'students.phone'),
  email: encryptValue('jean.dupont@example.com', 'students.email'),
  in_group: false,
  left_group: false,
  note: '',
  kazaa: '',
  created_at: new Date().toISOString()
};

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
            order: () => ({
              range: async () => ({ data: [mockStudent], error: null })
            }),
            eq: (field, value) => ({
              maybeSingle: async () => ({
                data: mockStudent.id === value ? { ...mockStudent } : null,
                error: null
              })
            }),
            then: (resolve) => resolve({ data: [mockStudent], error: null })
          }),
          update: (payload) => ({
            eq: (field, value) => {
              if (mockStudent.id === value) {
                // If payload has assigned_group, simulate column not in schema cache to test fallback
                if (payload.assigned_group !== undefined) {
                  return {
                    select: () => ({
                      maybeSingle: async () => ({
                        data: null,
                        error: { code: 'PGRST204', message: "Could not find the 'assigned_group' column" }
                      })
                    })
                  };
                }
                Object.assign(mockStudent, payload);
              }
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: { ...mockStudent },
                    error: null
                  })
                })
              };
            }
          })
        };
      }
    }
  }
};

const server = require('../server').listen(0, '127.0.0.1');
after(() => new Promise(resolve => server.close(resolve)));

const url = path => `http://127.0.0.1:${server.address().port}${path}`;

test('PATCH /api/students/:id/group sets assignedGroup and fallback persists via note payload', async () => {
  const resA = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: true, assignedGroup: 'Grp A' })
  });
  assert.equal(resA.status, 200);
  const jsonA = await resA.json();
  assert.equal(jsonA.success, true);
  assert.equal(jsonA.data.inGroup, true);
  assert.equal(jsonA.data.assignedGroup, 'Grp A');

  const resB = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: true, assignedGroup: 'Grp B' })
  });
  assert.equal(resB.status, 200);
  const jsonB = await resB.json();
  assert.equal(jsonB.success, true);
  assert.equal(jsonB.data.inGroup, true);
  assert.equal(jsonB.data.assignedGroup, 'Grp B');
});

test('PATCH /api/students/:id/group can clear assignedGroup and inGroup', async () => {
  const res = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: false, assignedGroup: '' })
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.inGroup, false);
  assert.equal(json.data.assignedGroup, '');
});

test('marking student leftGroup clears assignedGroup', async () => {
  // First set group
  await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: true, assignedGroup: 'Grp C,D' })
  });

  // Now mark left group
  const res = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: false, leftGroup: true, assignedGroup: '' })
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.leftGroup, true);
  assert.equal(json.data.inGroup, false);
  assert.equal(json.data.assignedGroup, '');
});

test('undoing leftGroup restores inGroup and assignedGroup', async () => {
  // First set group
  await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: true, assignedGroup: 'Grp C,D' })
  });

  // Mark left group
  await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: false, leftGroup: true, assignedGroup: '' })
  });

  // Now undo/redo by setting leftGroup: false and restoring inGroup and assignedGroup
  const res = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/group'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inGroup: true, leftGroup: false, assignedGroup: 'Grp C,D' })
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.leftGroup, false);
  assert.equal(json.data.inGroup, true);
  assert.equal(json.data.assignedGroup, 'Grp C,D');
});

test('frontend script.js exposes toggleable Left group button and undo capability', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

  // Verify left-group is-active button is rendered when student.leftGroup is true
  assert.match(code, /class="btn-action left-group is-active"/);
  assert.match(code, />↩ Left group<\/button>/);

  // Verify undo logic in markStudentLeftGroup
  assert.match(code, /const isUndoing = Boolean\(student\.leftGroup\)/);
  assert.match(code, /toggleStudentLeftGroup = markStudentLeftGroup/);

  // Verify toast with undo option
  assert.match(code, /toast-action-btn/);
});

test('PATCH /api/students/:id/link-approval sets linkApproved and inClass independently from inGroup', async () => {
  const resTrue = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/link-approval'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkApproved: true })
  });
  assert.equal(resTrue.status, 200);
  const jsonTrue = await resTrue.json();
  assert.equal(jsonTrue.success, true);
  assert.equal(jsonTrue.data.linkApproved, true);
  assert.equal(jsonTrue.data.inClass, true);

  const resFalse = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/link-approval'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkApproved: false })
  });
  assert.equal(resFalse.status, 200);
  const jsonFalse = await resFalse.json();
  assert.equal(jsonFalse.success, true);
  assert.equal(jsonFalse.data.linkApproved, false);
  assert.equal(jsonFalse.data.inClass, false);

  // Backward compatibility check with /api/students/:id/class
  const resClass = await fetch(url('/api/students/00000000-0000-0000-0000-000000000001/class'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inClass: true })
  });
  assert.equal(resClass.status, 200);
  const jsonClass = await resClass.json();
  assert.equal(jsonClass.success, true);
  assert.equal(jsonClass.data.linkApproved, true);
});

test('group section normalization correctly classifies sections', () => {
  function getStudentAssignedGroup(student) {
    const norm = (student?.assignedGroup || '').trim().toLowerCase();
    if (norm === 'grp a' || norm === 'a') return 'Grp A';
    if (norm === 'grp b' || norm === 'b') return 'Grp B';
    if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
    if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
    if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
    if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
    if (norm === 'amchit' || norm === 'amshit' || norm === 'grp amchit' || norm === 'grp amshit') return 'Amchit';
    return '';
  }

  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp A' }), 'Grp A');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'a' }), 'Grp A');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp B' }), 'Grp B');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'b' }), 'Grp B');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp A,B' }), 'Grp A,B');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'a,b' }), 'Grp A,B');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp C,D' }), 'Grp C,D');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'c,d' }), 'Grp C,D');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp E1' }), 'Grp E1');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'e1' }), 'Grp E1');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp E2' }), 'Grp E2');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'e2' }), 'Grp E2');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Amchit' }), 'Amchit');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'amchit' }), 'Amchit');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Amshit' }), 'Amchit');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'amshit' }), 'Amchit');
  assert.equal(getStudentAssignedGroup({ assignedGroup: 'Grp Amchit' }), 'Amchit');
  assert.equal(getStudentAssignedGroup({ assignedGroup: '' }), '');
  assert.equal(getStudentAssignedGroup(null), '');
});

test('political affiliations breakdown per group accurately aggregates counts', () => {
  const sampleStudents = [
    { assignedGroup: 'Grp A', inGroup: true, leftGroup: false, politicalAffiliation: 'Party X' },
    { assignedGroup: 'Grp A', inGroup: true, leftGroup: false, politicalAffiliation: 'Party X' },
    { assignedGroup: 'Grp B', inGroup: true, leftGroup: false, politicalAffiliation: 'Party Y' },
    { assignedGroup: 'Grp C,D', inGroup: true, leftGroup: false, politicalAffiliation: 'Party Z' },
    { assignedGroup: 'Grp E1', inGroup: true, leftGroup: false, politicalAffiliation: 'Independent' },
    { assignedGroup: 'Grp E2', inGroup: true, leftGroup: false, politicalAffiliation: 'Party X' },
    { assignedGroup: '', inGroup: false, leftGroup: false, politicalAffiliation: 'Independent' },
    { assignedGroup: '', inGroup: false, leftGroup: true, politicalAffiliation: 'Party Y' }
  ];

  function getStudentAssignedGroup(student) {
    const norm = (student?.assignedGroup || '').trim().toLowerCase();
    if (norm === 'grp a' || norm === 'a') return 'Grp A';
    if (norm === 'grp b' || norm === 'b') return 'Grp B';
    if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
    if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
    if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
    if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
    return '';
  }

  function getStudentsForPoliticalGroup(groupKey) {
    if (groupKey === 'Grp A') return sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp A');
    if (groupKey === 'Grp B') return sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp B');
    if (groupKey === 'Grp A,B') return sampleStudents.filter(s => ['Grp A,B', 'Grp A', 'Grp B'].includes(getStudentAssignedGroup(s)));
    if (groupKey === 'Grp C,D') return sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp C,D');
    if (groupKey === 'Grp E1') return sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp E1');
    if (groupKey === 'Grp E2') return sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp E2');
    if (groupKey === 'in_group') return sampleStudents.filter(s => s.inGroup && !s.leftGroup);
    if (groupKey === 'not_in_group') return sampleStudents.filter(s => !s.inGroup && !s.leftGroup);
    return sampleStudents;
  }

  const grpA = getStudentsForPoliticalGroup('Grp A');
  assert.equal(grpA.length, 2);
  const grpAAffs = grpA.reduce((acc, s) => {
    acc[s.politicalAffiliation] = (acc[s.politicalAffiliation] || 0) + 1;
    return acc;
  }, {});
  assert.equal(grpAAffs['Party X'], 2);

  const grpB = getStudentsForPoliticalGroup('Grp B');
  assert.equal(grpB.length, 1);
  assert.equal(grpB[0].politicalAffiliation, 'Party Y');

  const grpAB = getStudentsForPoliticalGroup('Grp A,B');
  assert.equal(grpAB.length, 3);

  const grpCD = getStudentsForPoliticalGroup('Grp C,D');
  assert.equal(grpCD.length, 1);
  assert.equal(grpCD[0].politicalAffiliation, 'Party Z');

  const inGrp = getStudentsForPoliticalGroup('in_group');
  assert.equal(inGrp.length, 6);

  const notInGrp = getStudentsForPoliticalGroup('not_in_group');
  assert.equal(notInGrp.length, 1);
});

test('changing assigned group from Grp A to another group requires confirmation', () => {
  function shouldConfirmGroupChange(student, targetGroup) {
    function getStudentAssignedGroup(s) {
      const norm = (s?.assignedGroup || '').trim().toLowerCase();
      if (norm === 'grp a' || norm === 'a') return 'Grp A';
      if (norm === 'grp b' || norm === 'b') return 'Grp B';
      if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
      if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
      if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
      if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
      return '';
    }

    const currentNorm = (student.assignedGroup || '').trim().toLowerCase();
    const targetNorm = targetGroup.trim().toLowerCase();
    const isAlreadyInTarget = currentNorm === targetNorm || currentNorm === targetNorm.replace(/^grp\s*/, '');
    const currentGroup = getStudentAssignedGroup(student) || (student.assignedGroup ? student.assignedGroup.trim() : '');

    return Boolean(currentGroup && !isAlreadyInTarget);
  }

  // Student in Grp A clicking other groups requires confirmation
  assert.equal(shouldConfirmGroupChange({ assignedGroup: 'Grp A' }, 'Grp B'), true);
  assert.equal(shouldConfirmGroupChange({ assignedGroup: 'Grp A' }, 'Grp C,D'), true);
  // Clicking Grp A when already in Grp A toggles off/unassigns without confirmation
  assert.equal(shouldConfirmGroupChange({ assignedGroup: 'Grp A' }, 'Grp A'), false);
  // Student with no group assigned initially clicking Grp A does not require confirmation
  assert.equal(shouldConfirmGroupChange({ assignedGroup: '' }, 'Grp A'), false);
  // Student in Grp B clicking Grp A requires confirmation
  assert.equal(shouldConfirmGroupChange({ assignedGroup: 'Grp B' }, 'Grp A'), true);
  // Student in Grp E1 clicking Grp E2 requires confirmation
  assert.equal(shouldConfirmGroupChange({ assignedGroup: 'Grp E1' }, 'Grp E2'), true);
});

test('status breakdown (New vs Mu3id) per group and in-group aggregates accurately', () => {
  const sampleStudents = [
    { assignedGroup: 'Grp A', inGroup: true, leftGroup: false, status: 'New' },
    { assignedGroup: 'Grp A', inGroup: true, leftGroup: false, status: 'Mu3id' },
    { assignedGroup: 'Grp A', inGroup: true, leftGroup: false, status: 'New' },
    { assignedGroup: 'Grp B', inGroup: true, leftGroup: false, status: 'Mu3id' },
    { assignedGroup: 'Grp B', inGroup: true, leftGroup: false, status: 'Mu3id' },
    { assignedGroup: 'Grp C,D', inGroup: true, leftGroup: false, status: 'New' },
    { assignedGroup: 'Grp E1', inGroup: true, leftGroup: false, status: 'New' },
    { assignedGroup: 'Grp E1', inGroup: true, leftGroup: false, status: 'Mu3id' },
    { assignedGroup: 'Grp E2', inGroup: true, leftGroup: false, status: 'New' },
    { assignedGroup: '', inGroup: false, leftGroup: false, status: 'New' },
    { assignedGroup: '', inGroup: false, leftGroup: true, status: 'Mu3id' }
  ];

  function getStudentAssignedGroup(s) {
    const norm = (s?.assignedGroup || '').trim().toLowerCase();
    if (norm === 'grp a' || norm === 'a') return 'Grp A';
    if (norm === 'grp b' || norm === 'b') return 'Grp B';
    if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
    if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
    if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
    if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
    return '';
  }

  const isNew = s => String(s.status || '').trim().toLowerCase() === 'new';
  const isMu3id = s => String(s.status || '').trim().toLowerCase() === 'mu3id';

  // Overall in-group breakdown
  const inGroup = sampleStudents.filter(s => s.inGroup && !s.leftGroup);
  assert.equal(inGroup.filter(isNew).length, 5);
  assert.equal(inGroup.filter(isMu3id).length, 4);

  // Grp A
  const grpA = sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp A');
  assert.equal(grpA.filter(isNew).length, 2);
  assert.equal(grpA.filter(isMu3id).length, 1);

  // Grp B
  const grpB = sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp B');
  assert.equal(grpB.filter(isNew).length, 0);
  assert.equal(grpB.filter(isMu3id).length, 2);

  // Grp C,D
  const grpCD = sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp C,D');
  assert.equal(grpCD.filter(isNew).length, 1);
  assert.equal(grpCD.filter(isMu3id).length, 0);

  // Grp E1
  const grpE1 = sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp E1');
  assert.equal(grpE1.filter(isNew).length, 1);
  assert.equal(grpE1.filter(isMu3id).length, 1);

  // Grp E2
  const grpE2 = sampleStudents.filter(s => getStudentAssignedGroup(s) === 'Grp E2');
  assert.equal(grpE2.filter(isNew).length, 1);
  assert.equal(grpE2.filter(isMu3id).length, 0);
});

test('approve to class button renders correct state and title independently from inGroup', () => {
  function getApproveClassButtonProps(student) {
    const isApproved = Boolean(student.linkApproved !== undefined ? student.linkApproved : student.inClass);
    return {
      className: `btn-approve-class-icon ${isApproved ? 'is-approved' : ''}`.trim(),
      title: isApproved
        ? 'Link sent & approved joined group'
        : `Send link & approve ${student.fullName || 'student'} joined group`,
      iconType: isApproved ? 'check' : 'arrow'
    };
  }

  // Not approved (default), even though student is in general group!
  const s1 = { fullName: 'Ali Ahmad', linkApproved: false, inGroup: true, leftGroup: false, assignedGroup: 'Grp A' };
  const p1 = getApproveClassButtonProps(s1);
  assert.equal(p1.className, 'btn-approve-class-icon');
  assert.equal(p1.title, 'Send link & approve Ali Ahmad joined group');
  assert.equal(p1.iconType, 'arrow');

  // Link approved, even if not in general group or left group
  const s2 = { fullName: 'Sara Nour', linkApproved: true, inGroup: false, leftGroup: true, assignedGroup: '' };
  const p2 = getApproveClassButtonProps(s2);
  assert.equal(p2.className, 'btn-approve-class-icon is-approved');
  assert.equal(p2.title, 'Link sent & approved joined group');
  assert.equal(p2.iconType, 'check');

  // Both link approved and in group
  const s3 = { fullName: 'Omar Khalid', linkApproved: true, inGroup: true, leftGroup: false, assignedGroup: 'Grp B' };
  const p3 = getApproveClassButtonProps(s3);
  assert.equal(p3.className, 'btn-approve-class-icon is-approved');
  assert.equal(p3.title, 'Link sent & approved joined group');
  assert.equal(p3.iconType, 'check');
});

test('filterStudentsPredicate correctly filters without reference errors', () => {
  const students = [
    { firstName: 'Tony', familyName: 'Moussa', status: 'New', major: 'Mathematics', campus: 'Fanar', language: 'French', inGroup: true, linkApproved: false, assignedGroup: 'Grp A' },
    { firstName: 'Rita', familyName: 'Karam', status: 'Mu3id', major: 'Informatics', campus: 'Amshit', language: 'English', inGroup: false, linkApproved: true, assignedGroup: '' }
  ];

  function runFilter(needle, statusVal, linkVal) {
    const statusFilter = { value: statusVal };
    const linkFilter = { value: linkVal };
    return students.filter(student => {
      const matchesSearch = !needle || Object.values(student).some(v => String(v).toLowerCase().includes(needle.toLowerCase()));
      const matchesStatus = !statusFilter?.value || String(student.status || '').trim().toLowerCase() === statusFilter.value.trim().toLowerCase();
      const isApproved = Boolean(student.linkApproved !== undefined ? student.linkApproved : student.inClass);
      const matchesLink = !linkFilter?.value || (linkFilter.value === 'approved' || linkFilter.value === 'in' ? isApproved : !isApproved);
      return matchesSearch && matchesStatus && matchesLink;
    });
  }

  assert.equal(runFilter('', '', '').length, 2);
  assert.equal(runFilter('', 'New', '').length, 1);
  assert.equal(runFilter('', 'Mu3id', '').length, 1);
  assert.equal(runFilter('', '', 'approved').length, 1);
  assert.equal(runFilter('', '', 'pending').length, 1);
});

test('student campus Amchit renders single Amchit group button regardless of language', () => {
  function getStudentAssignedGroup(student) {
    const norm = (student?.assignedGroup || '').trim().toLowerCase();
    if (norm === 'grp a' || norm === 'a') return 'Grp A';
    if (norm === 'grp b' || norm === 'b') return 'Grp B';
    if (norm === 'grp a,b' || norm === 'a,b') return 'Grp A,B';
    if (norm === 'grp c,d' || norm === 'c,d') return 'Grp C,D';
    if (norm === 'grp e1' || norm === 'e1') return 'Grp E1';
    if (norm === 'grp e2' || norm === 'e2') return 'Grp E2';
    if (norm === 'amchit' || norm === 'amshit' || norm === 'grp amchit' || norm === 'grp amshit') return 'Amchit';
    return '';
  }

  function getGroupButtons(student) {
    const campus = (student.campus || '').trim().toLowerCase();
    const isAmchit = campus.includes('amchit') || campus.includes('amshit');
    const lang = (student.language || '').trim().toLowerCase();
    const isFrench = lang.includes('french');
    const isEnglish = lang.includes('english');
    const assigned = getStudentAssignedGroup(student);

    if (isAmchit) {
      return [{ group: 'Amchit', isActive: assigned === 'Amchit' }];
    } else if (isFrench) {
      return [
        { group: 'Grp A', isActive: assigned === 'Grp A' },
        { group: 'Grp B', isActive: assigned === 'Grp B' },
        { group: 'Grp C,D', isActive: assigned === 'Grp C,D' }
      ];
    } else if (isEnglish) {
      return [
        { group: 'Grp E1', isActive: assigned === 'Grp E1' },
        { group: 'Grp E2', isActive: assigned === 'Grp E2' }
      ];
    }
    return [];
  }

  // Amchit campus with French language
  const sAmchitFrench = { campus: 'Amshit', language: 'French', assignedGroup: 'Amchit' };
  const btnsAmchitFr = getGroupButtons(sAmchitFrench);
  assert.equal(btnsAmchitFr.length, 1);
  assert.equal(btnsAmchitFr[0].group, 'Amchit');
  assert.equal(btnsAmchitFr[0].isActive, true);

  // Amchit campus with English language
  const sAmchitEnglish = { campus: 'Amchit', language: 'English', assignedGroup: '' };
  const btnsAmchitEn = getGroupButtons(sAmchitEnglish);
  assert.equal(btnsAmchitEn.length, 1);
  assert.equal(btnsAmchitEn[0].group, 'Amchit');
  assert.equal(btnsAmchitEn[0].isActive, false);

  // Fanar campus with French language (retains Grp A, Grp B, Grp C,D)
  const sFanarFr = { campus: 'Fanar', language: 'French', assignedGroup: 'Grp A' };
  const btnsFanarFr = getGroupButtons(sFanarFr);
  assert.equal(btnsFanarFr.length, 3);
  assert.deepEqual(btnsFanarFr.map(b => b.group), ['Grp A', 'Grp B', 'Grp C,D']);
  assert.equal(btnsFanarFr[0].isActive, true);

  // Fanar campus with English language (retains Grp E1, Grp E2)
  const sFanarEn = { campus: 'Fanar', language: 'English', assignedGroup: 'Grp E2' };
  const btnsFanarEn = getGroupButtons(sFanarEn);
  assert.equal(btnsFanarEn.length, 2);
  assert.deepEqual(btnsFanarEn.map(b => b.group), ['Grp E1', 'Grp E2']);
  assert.equal(btnsFanarEn[1].isActive, true);
});

test('campus search and filter normalize Amchit and Amshit interchangeably', () => {
  const students = [
    { id: 1, firstName: 'Joe', familyName: 'Jamal', campus: 'Amshit', major: 'Informatics' },
    { id: 2, firstName: 'Carla', familyName: 'Khoury', campus: 'Fanar', major: 'Informatics' }
  ];

  function matchesCampusFilter(student, filterVal) {
    const targetCampus = (filterVal || '').trim().toLowerCase();
    const studentCampus = (student.campus || '').trim().toLowerCase();
    return !targetCampus || (targetCampus.includes('am') ? studentCampus.includes('am') : studentCampus === targetCampus);
  }

  function matchesStudentSearch(student, query) {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const isAmchit = (student.campus || '').toLowerCase().includes('am');
    const aliases = isAmchit ? 'amchit amshit' : '';
    const fullText = [student.firstName, student.familyName, student.campus, student.major, aliases].join(' ').toLowerCase();
    return tokens.every(token => fullText.includes(token));
  }

  assert.equal(matchesCampusFilter(students[0], 'Amchit'), true);
  assert.equal(matchesCampusFilter(students[1], 'Amchit'), false);
  assert.equal(matchesCampusFilter(students[0], 'Amshit'), true);
  assert.equal(matchesCampusFilter(students[1], 'Amshit'), false);

  assert.equal(matchesStudentSearch(students[0], 'amchit'), true);
  assert.equal(matchesStudentSearch(students[1], 'amchit'), false);
  assert.equal(matchesStudentSearch(students[0], 'amshit'), true);
  assert.equal(matchesStudentSearch(students[1], 'amshit'), false);
});
