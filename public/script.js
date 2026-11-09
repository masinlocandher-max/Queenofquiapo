(() => {
  const legacySchedule = {
    '#programme': '/schedule/',
    '#schedule': '/schedule/',
    '#guide': '/schedule/#guide',
    '#screening': '/schedule/#screening',
    '#coronation': '/schedule/#coronation'
  };

  function redirectOldLink() {
    if (location.pathname === '/' && legacySchedule[location.hash]) {
      location.replace(legacySchedule[location.hash]);
      return true;
    }
    return false;
  }

  if (redirectOldLink()) return;

  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-open]');
    if (opener) {
      const dialog = document.getElementById(opener.dataset.open);
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      return;
    }

    const closeButton = event.target.closest('[data-close]');
    if (closeButton) {
      closeButton.closest('dialog')?.close();
    } else if (event.target instanceof HTMLDialogElement) {
      const box = event.target.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) event.target.close();
    }
  });

  const tablist = document.querySelector('[data-event-tabs]');
  if (!tablist) {
    window.addEventListener('hashchange', redirectOldLink);
    return;
  }

  const tabs = Array.from(tablist.querySelectorAll('a[href^="#"]'));
  tablist.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    const panel = document.getElementById(tab.hash.slice(1));
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
  }

  function select(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.hash.slice(1)).hidden = !active;
    }
  }

  function selectFromLocation() {
    select(tabs.find(tab => tab.hash === location.hash) || tabs[0]);
    if (location.hash === '#guide') document.getElementById('guide').scrollIntoView();
  }

  function activate(tab) {
    select(tab);
    history.replaceState(null, '', tab.hash);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      activate(tab);
    });
    tab.addEventListener('keydown', event => {
      let next;
      switch (event.key) {
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        case ' ': next = index; break;
        default: return;
      }
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
  window.addEventListener('hashchange', selectFromLocation);
  selectFromLocation();
})();
