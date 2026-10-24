(function () {
  const pages = {
    dashboard: ['Dashboard', 'Live overview of today’s operations and performance.'],
    pos: ['POS & Billing', 'Take orders, manage tables, split bills and complete payments.'],
    menuadmin: ['Menu Management', 'Add items, update prices and control what appears in POS.'],
    dayclose: ['Business Day', 'Open, review and close the business day when you decide.'],
    staff: ['Staff & Attendance', 'Manage team members, attendance and staff access.'],
    servers: ['Servers', 'Create and manage accounts that can sign in to the Server workspace.'],
    inventory: ['Inventory', 'Track kitchen and bar stock with clear movement records.'],
    recipes: ['Recipes', 'Map menu items to ingredients for stock deduction and food cost.'],
    wastage: ['Wastage', 'Record stock loss and understand its cost.'],
    vendors: ['Vendors', 'Keep supplier details and purchase history organized.'],
    expenses: ['Expenses', 'Record operating expenses and payment sources.'],
    customers: ['Customers', 'Manage customer records and complaints in one place.'],
    reports: ['Reports & Sellers', 'Review sales, best sellers, least sellers and business trends.'],
    dailyreport: ['Daily Business Report', 'Select any calendar date to add, review or edit that day’s business.'],
    dining: ['Average Dining Time', 'Track table-wise dining duration and service patterns.'],
    capital: ['Owner Funds & Cash', 'Track owner investments, withdrawals and transfers between accounts.'],
    settings: ['Settings & Backup', 'Business settings, website, payments, backup, recovery and reset controls.'],
    online: ['Online Orders', 'Accept, prepare and complete guest orders from the public website.']
  };

  const original = window.hardNav;
  if (typeof original === 'function') {
    window.hardNav = function (sec) {
      const result = original(sec);
      const entry = pages[sec];
      if (entry && window.TeaUI) TeaUI.setPageHeader(entry[0], entry[1]);
      return result;
    };
  }

  function showDashboardContext() {
    if (window.TeaUI) TeaUI.setPageHeader(pages.dashboard[0], pages.dashboard[1]);
  }

  function installMenu() {
    const sidebar = document.getElementById('ownerSidebar');
    const toggle = document.getElementById('ownerMenuToggle');
    const backdrop = document.getElementById('ownerMenuBackdrop');
    const nav = document.getElementById('nav');
    if (!sidebar || !toggle || !backdrop || !nav) return;
    const close = (restoreFocus = false) => {
      sidebar.classList.remove('menu-open');
      document.body.classList.remove('owner-menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
      if (restoreFocus) toggle.focus();
    };
    toggle.addEventListener('click', () => {
      const open = !sidebar.classList.contains('menu-open');
      sidebar.classList.toggle('menu-open', open);
      document.body.classList.toggle('owner-menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    });
    backdrop.addEventListener('click', () => close(true));
    nav.addEventListener('click', (event) => {
      if (event.target.closest('[data-sec]')) close(true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('menu-open')) close(true);
    });
    window.matchMedia('(min-width: 1101px)').addEventListener('change', (event) => {
      if (event.matches) close();
    });
  }

  function installLogout() {
    const button = document.getElementById('cloudLogoutAction');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (!response.ok) throw new Error(`Logout failed (${response.status})`);
        try { window.localStorage.removeItem('tea-amo-admin'); } catch {}
        window.location.replace('/staff/login');
      } catch (error) {
        console.error(error);
        button.disabled = false;
        window.alert('Could not log out. Please try again.');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { showDashboardContext(); installMenu(); installLogout(); });
  } else {
    showDashboardContext();
    installMenu();
    installLogout();
  }
})();
