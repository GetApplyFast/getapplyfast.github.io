// ApplyFast Interactive Demo: a fictional ERP "Customer Payment" page. It renders the demo invoices
// in the Invoices sublist markup ApplyFast reads (table#apply_splits, tr#applyheader with
// td[data-label], tr#applyrowN, apply/amount/disc inputs), pages them through the Range menu and
// keeps the header totals equal to the ticked Payment fields on all pages. Save is local to this page:
// no request is made and nothing leaves the browser.
(function () {
  'use strict';

  const DATA = window.ApplyFastDemoData;
  const INVOICES = DATA.invoices;
  const PAGE_SIZE = DATA.pageSize;
  // The Range text changes at once and the rows arrive a moment later.
  const LOAD_MS = 700;

  const LABELS = ['Apply', 'Date', 'Type', 'Ref No.', 'Orig. Amt.', 'Amt. Due',
    'Currency', 'Disc. Date', 'Disc. Avail.', 'Disc. Taken', 'Payment', 'PO/Check Number'];

  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseUS = s => {
    const n = parseFloat(String(s || '').replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sortKey = ref => (ref.replace(/\D/g, '') || '0').padStart(38, '0');

  // What the page remembers for every line, across pages, until Save.
  const lines = INVOICES.map(() => ({ apply: false, amount: '', disc: '' }));
  const pages = [];
  for (let s = 1; s <= INVOICES.length; s += PAGE_SIZE) pages.push({ start: s, end: Math.min(s + PAGE_SIZE - 1, INVOICES.length) });
  const rangeText = p => `${p.start} to ${p.end} of ${INVOICES.length}`;

  function headerRow() {
    return '<tr class="uir-machine-headerrow" id="applyheader">' +
      LABELS.map(l => `<td data-label="${l}"><div class="listheader">${l}</div></td>`).join('') +
      '</tr>';
  }

  function invoiceRow(idx) {
    const inv = INVOICES[idx];
    const i = idx + 1;
    const line = lines[idx];
    const ref = esc(inv.ref);
    const href = `#invoice-${ref}`;
    return `<tr class="uir-list-row-tr${line.apply ? ' erp-applied' : ''}" id="applyrow${idx}">` +
      `<td><span id="apply${i}_fs"><input type="checkbox" class="checkbox" value="T" name="apply${i}" id="apply${i}"${line.apply ? ' checked' : ''}></span></td>` +
      `<td><a class="dottedlink" href="${href}">${inv.date}</a></td>` +
      `<td><a class="dottedlink" href="${href}">Invoice</a></td>` +
      `<td><span style="display:none">${sortKey(inv.ref)}</span>${ref}</td>` +
      `<td class="erp-num">${fmt(inv.orig)}</td>` +
      `<td class="erp-num">${fmt(inv.due)}</td>` +
      '<td>USD</td>' +
      `<td>${inv.discDate}</td>` +
      `<td class="erp-num">${inv.discAvail ? fmt(inv.discAvail) : ''}</td>` +
      `<td><span id="apply_disc${i}_fs"><input type="text" id="disc${i}_formattedValue" name="disc${i}_formattedValue" aria-label="Disc. Taken ${ref}" value="${esc(line.disc)}"><input type="hidden" id="disc${i}" name="disc${i}"></span></td>` +
      `<td style="display:none"><input type="hidden" name="userenteredamount${i}" value=""></td>` +
      `<td style="display:none"><input type="hidden" name="userentereddiscount${i}" value="F"></td>` +
      `<td><span id="apply_amount${i}_fs"><input type="text" id="amount${i}_formattedValue" name="amount${i}_formattedValue" aria-label="Payment ${ref}" value="${esc(line.amount)}"><input type="hidden" id="amount${i}" name="amount${i}"></span></td>` +
      `<td>${esc(inv.po)}</td>` +
      '</tr>';
  }

  const rangeInput = document.getElementById('inpt_applyrange_9');
  const rangeHidden = document.getElementById('hddn_applyrange_9');
  const menu = document.getElementById('erpRangeMenu');
  let current = 0;

  function renderRows(pageIndex) {
    if (saved) return renderSavedRows();
    const p = pages[pageIndex];
    let html = headerRow();
    for (let idx = p.start - 1; idx < p.end; idx++) html += invoiceRow(idx);
    document.getElementById('rows').innerHTML = html;
  }

  // A saved payment lists only the invoices it was applied to, from every page.
  function renderSavedRows() {
    const idxs = savedRows;
    document.getElementById('rows').innerHTML = headerRow() + idxs.map(invoiceRow).join('');
    document.querySelectorAll('#apply_splits input').forEach(input => { input.disabled = true; });
    document.querySelectorAll('#apply_splits tr[id^="applyrow"]').forEach(tr => tr.classList.add('erp-row-saved'));
    rangeInput.value = `1 to ${idxs.length} of ${idxs.length}`;
    rangeInput.disabled = true;
    menu.hidden = true;
  }

  function showPage(pageIndex) {
    current = pageIndex;
    rangeInput.value = rangeText(pages[pageIndex]);
    rangeHidden.value = String(pageIndex);
    setTimeout(() => { if (current === pageIndex) renderRows(pageIndex); }, LOAD_MS);
  }

  menu.innerHTML = pages.map((p, k) => `<div class="erp-range-opt" data-page="${k}">${rangeText(p)}</div>`).join('');
  rangeInput.addEventListener('click', () => {
    menu.querySelectorAll('.erp-range-opt').forEach(o => o.classList.toggle('is-selected', Number(o.dataset.page) === current));
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', e => {
    const opt = e.target.closest('.erp-range-opt');
    if (!opt) return;
    menu.hidden = true;
    const k = Number(opt.dataset.page);
    if (k !== current) showPage(k);
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && e.isTrusted && e.target !== rangeInput && !menu.contains(e.target)) menu.hidden = true;
  });

  function readLine(tr) {
    const m = /^applyrow(\d+)$/.exec(tr.id);
    if (!m) return;
    const line = lines[Number(m[1])];
    line.apply = tr.querySelector('input[type="checkbox"]').checked;
    line.amount = tr.querySelector('input[id^="amount"][id$="_formattedValue"]').value;
    line.disc = tr.querySelector('input[id^="disc"][id$="_formattedValue"]').value;
    tr.classList.toggle('erp-applied', line.apply);
  }

  // A hand-ticked Apply box fills Payment with the Amt. Due; unticking clears the line.
  function onCheckbox(box) {
    const tr = box.closest('tr[id^="applyrow"]');
    if (!tr) return;
    const idx = Number(tr.id.slice('applyrow'.length));
    const amount = tr.querySelector('input[id^="amount"][id$="_formattedValue"]');
    const disc = tr.querySelector('input[id^="disc"][id$="_formattedValue"]');
    if (box.checked && !amount.value) amount.value = fmt(INVOICES[idx].due);
    if (!box.checked) { amount.value = ''; disc.value = ''; }
  }

  function recalc() {
    if (saved) return;
    document.querySelectorAll('#apply_splits tr[id^="applyrow"]').forEach(readLine);
    const total = lines.reduce((sum, l) => sum + (l.apply ? parseUS(l.amount) : 0), 0);
    const text = fmt(total);
    document.getElementById('applied').value = text;
    document.getElementById('erpPayment').value = text;
    document.getElementById('erpToApply').textContent = text;
  }
  document.addEventListener('change', e => { if (e.target.closest && e.target.closest('#apply_splits')) recalc(); }, true);
  document.addEventListener('click', e => {
    const box = e.target.closest && e.target.closest('#apply_splits input[type="checkbox"]');
    if (!box) return;
    if (e.isTrusted) onCheckbox(box);
    setTimeout(recalc, 0);
  }, true);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#apply_splits a.dottedlink')) e.preventDefault(); });

  // Save only happens in this page: it freezes the lines and shows a fictional transaction number.
  const TRANSACTION = 'PAY-DEMO-100184';
  const saveBtn = document.getElementById('btn_multibutton_submitter');
  const status = document.getElementById('erpStatus');
  const LEAVE_MS = 450;
  let saved = null;
  let savedRows = [];

  function refuse(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function save() {
    if (saved) return;
    const box = document.getElementById('applyFastBox');
    if (box && /^applying/.test(box.dataset.state || '')) return refuse('Wait for ApplyFast to finish applying before saving.');
    if (box && /^resetting/.test(box.dataset.state || '')) return refuse('Wait for ApplyFast to finish resetting before saving.');
    recalc();
    const appliedIdx = lines.map((l, i) => (l.apply && parseUS(l.amount) > 0 ? i : -1)).filter(i => i >= 0);
    const applied = appliedIdx.map(i => lines[i]);
    if (!applied.length) return refuse('Apply at least one invoice before saving.');
    savedRows = appliedIdx;
    const round = n => Math.round(n * 100) / 100;
    saved = {
      transaction: TRANSACTION,
      customer: DATA.customer.name,
      payment: round(applied.reduce((sum, l) => sum + parseUS(l.amount), 0)),
      discount: round(applied.reduce((sum, l) => sum + parseUS(l.disc), 0)),
      appliedCount: applied.length,
      status: 'Saved'
    };
    status.hidden = true;
    document.body.classList.add('erp-is-saved');
    document.querySelectorAll('#apply_splits input').forEach(input => { input.disabled = true; });
    saveBtn.value = 'Saved';
    saveBtn.disabled = true;
    document.querySelector('.uir-page-title').textContent = `Customer Payment #${TRANSACTION}`;
    const panel = document.getElementById('erpSaved');
    panel.innerHTML = `<b>&#10003; Payment Saved</b><span>Transaction # ${TRANSACTION}</span><span>Status: Saved</span>` +
      '<em>Demo transaction &mdash; fictional environment</em>';
    panel.hidden = false;
    // Rows that were not part of the payment fade out, then the saved list replaces the page.
    document.querySelectorAll('#apply_splits tr[id^="applyrow"]:not(.erp-applied)').forEach(tr => tr.classList.add('erp-row-leaving'));
    setTimeout(renderSavedRows, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : LEAVE_MS);
  }
  saveBtn.addEventListener('click', save);
  document.getElementById('demoReset').addEventListener('click', () => location.reload());

  document.getElementById('inpt_customer1').value = DATA.customer.name;
  document.getElementById('hddn_customer_fs').value = DATA.customer.id;
  rangeInput.value = rangeText(pages[0]);
  renderRows(0);

  // Read-only view of the page state for tests and the demo shell.
  window.ApplyFastDemo = {
    lines: () => { recalc(); return lines.map((l, i) => Object.assign({ ref: INVOICES[i].ref }, l)); },
    applied: () => document.getElementById('applied').value,
    page: () => ({ current: current + 1, total: pages.length }),
    saved: () => (saved ? Object.assign({}, saved) : null),
    visibleRefs: () => Array.from(document.querySelectorAll('#apply_splits tr[id^="applyrow"]')).map(tr => INVOICES[Number(tr.id.slice('applyrow'.length))].ref)
  };
})();
