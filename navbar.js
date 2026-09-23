(() => {
  const header = document.querySelector('.topbar');
  const page = document.body?.dataset.page || '';
  if (!header || page === 'login' || page === 'signup') return;

  const pages = [
    {
      id: 'kazaa',
      href: 'kazaa.html',
      label: 'Students by Kazaa',
      icon: '<path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/>'
    },
    {
      id: 'dashboard',
      href: 'dashboard.html',
      label: 'Dashboard',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
    },
    {
      id: 'form',
      href: 'form.html',
      label: 'Add Student',
      primary: true,
      icon: '<path d="M12 5v14M5 12h14"/>'
    },
    {
      id: 'users',
      href: 'users.html',
      label: 'Users',
      icon: '<circle cx="9" cy="8" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 11a4 4 0 0 1 5 4v2"/>'
    },
    {
      id: 'backup',
      href: 'backup.html',
      label: 'Backups',
      icon: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'
    },
    {
      id: 'email-config',
      href: 'email-config.html',
      label: 'Email Settings',
      icon: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"/>'
    }
  ];

  const activePage = page === 'kazaa-export' ? 'kazaa' : page;
  const links = pages.map(item => {
    const active = item.id === activePage;
    const classes = ['nav-link', item.primary ? 'btn-nav' : '', active ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="${item.href}" class="${classes}" aria-label="${item.label}" title="${item.label}"${active ? ' aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>
      <span>${item.label}</span>
    </a>`;
  }).join('');

  header.innerHTML = `
    <a href="dashboard.html" class="brand" aria-label="student-os.com home">
      <span class="brand-mark orange-mark" aria-hidden="true">S</span>
      <span class="brand-name">student-os<b>.com</b></span>
    </a>
    <div class="header-center">
      <div class="db-pill" id="dbStatusPill" title="student-os.com system status">
        <span class="db-dot" aria-hidden="true"></span>
        <span id="dbStatusText">Checking system...</span>
      </div>
    </div>
    <div class="header-right">
      <nav class="nav-links" aria-label="Main navigation">${links}</nav>
      <div class="user-badge" id="userBadge">
        <span class="user-name" id="userNameDisplay">Admin</span>
        <button type="button" class="btn-logout" id="logoutBtn" title="Sign out">Logout</button>
      </div>
    </div>`;
})();
