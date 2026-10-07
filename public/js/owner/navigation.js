(function () {
  const pages = {
    dashboard: ['Dashboard', 'Live overview of today’s operations and performance.'],
    pos: ['POS & Billing', 'Take orders, manage tables, split bills and complete payments.'],
    menuadmin: ['Menu Management', 'Add items, update prices and control what appears in POS.'],
    dayclose: ['Business Day', 'Open, review and close the business day when you decide.'],
    staff: ['Staff & Attendance', 'Manage team members, attendance and staff access.'],
    inventory: ['Inventory', 'Track kitchen and bar stock with clear movement records.'],
    recipes: ['Recipes', 'Connect menu items to ingredient usage and automatic stock deduction.'],
    wastage: ['Wastage', 'Record stock loss and understand its cost.'],
    vendors: ['Vendors', 'Keep supplier details and purchase history organized.'],
    expenses: ['Expenses', 'Record operating expenses and payment sources.'],
    customers: ['Customers', 'Manage customer records and complaints in one place.'],
    reports: ['Reports & Sellers', 'Review sales, best sellers, least sellers and business trends.'],
    dailyreport: ['Daily Business Report', 'Select any calendar date to add, review or edit that day’s business.'],
    dining: ['Average Dining Time', 'Track table-wise dining duration and service patterns.'],
    capital: ['Owner Funds & Cash', 'Track available balance, investment, withdrawals and money movement.'],
    settings: ['Settings & Backup', 'Business settings, payments, backup, recovery and reset controls.']
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showDashboardContext);
  } else {
    showDashboardContext();
  }
})();
