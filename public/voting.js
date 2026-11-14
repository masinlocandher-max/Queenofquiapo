// Voting page: official candidates, voting packages and, only when the server says payments are live, checkout.
// Prices and points always come from the server. The browser never decides that a payment succeeded.
(() => {
  const {post, make, number, peso, valid, candidateCard} = window.QOQPublic;
  const byId = id => document.getElementById(id);
  const status = byId('vote-status'), candidateGrid = byId('candidate-grid'), packageGrid = byId('package-grid');
  const checkout = byId('checkout'), soon = byId('payment-soon'), receipt = byId('order-receipt'), feedback = byId('checkout-feedback');
  if (!candidateGrid) return;
  let catalog = null, candidate = null, pack = null, pending = false, order = null;
  // One request id per intended purchase, so a double-click or refresh returns the same order instead of a second one.
  const newRequestId = () => self.crypto.randomUUID ? self.crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ self.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  let requestId = newRequestId();

  function choice(group, value, content, onPick) {
    const label = make('label', undefined, 'choice'), radio = make('input');
    radio.type = 'radio'; radio.name = group; radio.value = value;
    radio.addEventListener('change', onPick);
    label.append(radio, content);
    return label;
  }
  function summary() {
    byId('sum-candidate').textContent = candidate ? (candidate.number != null ? 'No. ' + candidate.number + ' · ' : '') + candidate.name : 'Not selected';
    byId('sum-package').textContent = pack ? pack.name : 'Not selected';
    byId('sum-points').textContent = pack ? number(pack.points) + ' points' : '—';
    byId('sum-price').textContent = pack ? peso(pack.priceCentavos) : '—';
    byId('pay').disabled = pending || !candidate || !pack;
    feedback.textContent = '';
  }
  function render() {
    const candidates = (Array.isArray(catalog.candidates) ? catalog.candidates : []).filter(valid);
    const packages = (Array.isArray(catalog.packages) ? catalog.packages : []).filter(p => typeof p?.id === 'string' && Number.isSafeInteger(p.points) && Number.isSafeInteger(p.priceCentavos) && p.priceCentavos === p.points * 10);
    const live = catalog.paymentsEnabled === true && catalog.voting === 'open';
    candidateGrid.replaceChildren(...candidates.map(item => choice('candidate', item.id, candidateCard(item, catalog.pointsPublic === true), () => { candidate = item; requestId = newRequestId(); summary(); })));
    byId('roster-empty').hidden = candidates.length > 0;
    byId('candidate-help').hidden = !candidates.length;
    packageGrid.replaceChildren(...packages.map(item => {
      const card = make('div', undefined, 'package-card');
      card.append(make('p', item.name.toUpperCase(), 'eyebrow'), make('p', number(item.points), 'package-points'), make('p', 'voting points', 'package-unit'), make('p', peso(item.priceCentavos), 'package-price'));
      return choice('package', item.id, card, () => { pack = item; requestId = newRequestId(); summary(); });
    }));
    soon.hidden = live; checkout.hidden = !live;
    status.textContent = live ? 'Voting is open. Choose a candidate and a package below.'
      : catalog.voting === 'closed' || catalog.voting === 'finalized' ? 'Voting has closed for this edition. Thank you for supporting the queens of Quiapo.'
      : 'Support an official candidate with voting points. Online payment has not opened yet.';
    if (catalog.voting === 'closed' || catalog.voting === 'finalized') { soon.querySelector('h3').textContent = 'Voting has closed'; soon.querySelector('p:not(.eyebrow)').textContent = 'No further purchases are accepted for this edition.'; }
    summary();
  }
  const stateText = {created:'Order created. Payment has not been received.', awaiting_payment:'Waiting for your payment.', processing:'The payment provider is processing your payment.',
    paid:'Payment confirmed.', failed:'The payment did not go through. No points were added.', expired:'This order expired before payment. No points were added.', cancelled:'Payment was cancelled. No points were added.',
    refunded:'This payment was refunded and its points removed.', partially_refunded:'This payment was partly refunded.', reversed:'This payment was reversed and its points removed.'};
  function showOrder(next, checkoutUrl) {
    order = next;
    try { sessionStorage.setItem('qoq-order', order.orderRef); } catch {}
    byId('order-ref').textContent = order.orderRef;
    byId('order-candidate').textContent = (order.candidate?.number != null ? 'No. ' + order.candidate.number + ' · ' : '') + (order.candidate?.name || '');
    byId('order-package').textContent = order.package + ' · ' + number(order.points) + ' points · ' + peso(order.amountCentavos);
    byId('order-state').textContent = stateText[order.status] || 'Status unavailable.';
    byId('order-note').textContent = order.creditStatus === 'credited' ? number(order.points) + ' points have been added to your candidate. Keep your order reference as your receipt.'
      : order.status === 'paid' ? 'Your payment is confirmed. The organizers will review when these points are counted, because it was confirmed outside the voting period.'
      : ['created','awaiting_payment','processing'].includes(order.status) ? 'Points are added only after the payment provider confirms your payment to us. If you have already paid, this can take a few minutes: check the status again.' : '';
    const pay = byId('order-pay');
    pay.hidden = !(checkoutUrl && ['created','awaiting_payment'].includes(order.status)); if (!pay.hidden) pay.href = checkoutUrl;
    checkout.hidden = true; receipt.hidden = false; byId('order-title').focus();
  }
  async function refreshOrder(ref) {
    try { showOrder(await post('order.status', {orderRef: ref})); }
    catch (error) { byId('order-state').textContent = typeof error.status === 'number' ? error.message : 'We could not reach the server. Your order is safe; check again shortly.'; }
  }

  checkout.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !candidate || !pack) return;
    if (!checkout.reportValidity()) return;
    pending = true; summary(); feedback.textContent = 'Creating your order…';
    try {
      const result = await post('order.create', {candidateId: candidate.id, packageId: pack.id, requestId, email: checkout.email.value.trim(), name: checkout.name.value.trim()});
      feedback.textContent = '';
      showOrder(result.order, result.checkoutUrl);
    } catch (error) {
      feedback.textContent = typeof error.status === 'number' ? error.message : 'Your connection was interrupted. Nothing was charged. Try again: you will not be charged twice.';
    } finally { pending = false; summary(); }
  });
  byId('order-refresh').addEventListener('click', () => { if (order) refreshOrder(order.orderRef); });
  byId('order-print').addEventListener('click', () => window.print());

  post('public.catalog').then(data => {
    catalog = data; render();
    let saved = new URLSearchParams(location.search).get('order');
    try { saved = saved || sessionStorage.getItem('qoq-order'); } catch {}
    if (/^QV-[A-F0-9]{32}$/.test(saved || '')) refreshOrder(saved);
  }).catch(() => { status.textContent = 'Voting information is temporarily unavailable. Please check back shortly.'; byId('roster-empty').hidden = true; });
})();
