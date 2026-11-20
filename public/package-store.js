// Package displays share authoritative catalog prices. Previewing never creates an order.
(() => {
  const {make, number, peso, post} = window.QOQPublic;
  const tones = {quartz:'quartz',amethyst:'amethyst',sapphire:'sapphire',emerald:'emerald',ruby:'ruby',diamond:'diamond'};
  window.QOQPackageCard = (item, action) => {
    const card = make('div', undefined, 'package-card stone-card');
    card.dataset.stone = tones[String(item.name).toLowerCase()] || 'quartz';
    const art = make('div', undefined, 'stone-art'); art.setAttribute('aria-hidden','true');
    const gem = make('span', undefined, 'stone-gem'); gem.append(make('i'),make('i'),make('i')); art.append(gem);
    const body = make('div', undefined, 'stone-body');
    body.append(make('p', 'VOTING PACKAGE', 'stone-kicker'), make('h3',item.name,'stone-name'), make('p',peso(item.priceCentavos),'package-price'));
    const points = make('p', undefined, 'stone-points'); points.append(make('strong',number(item.points)),document.createTextNode(' voting points'));
    body.append(points,make('span',action,'stone-action')); card.append(art,body); return card;
  };
  const grid = document.getElementById('store-packages'); if (!grid) return;
  post('public.catalog').then(catalog => {
    const packages = (catalog.packages || []).filter(p => typeof p.name === 'string' && Number.isSafeInteger(p.points) && p.points >= 1000 && Number.isSafeInteger(p.priceCentavos) && p.priceCentavos === p.points*10);
    const live = catalog.paymentsEnabled === true && catalog.voting === 'open';
    document.getElementById('store-status').textContent = live ? 'Voting is open' : ['closed','finalized'].includes(catalog.voting) ? 'Voting has closed' : 'Payment coming soon';
    grid.replaceChildren(...packages.map(item => {
      const link = make('a', undefined, 'stone-product'); link.href = '/vote/?package=' + encodeURIComponent(item.id) + '#step-package';
      link.setAttribute('aria-label',item.name + ': ' + peso(item.priceCentavos) + ' for ' + number(item.points) + ' voting points. View package.');
      link.append(window.QOQPackageCard(item,'View package')); return link;
    }));
    if (!packages.length) grid.append(make('p','The package collection is being prepared. Please check back soon.','store-loading'));
  }).catch(() => { grid.replaceChildren(make('p','The package collection is temporarily unavailable. Please try again shortly.','store-loading')); });
})();
