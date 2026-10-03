// ApplyFast Interactive Demo scenarios: fictional customer remittances, as the customer sent them.
// Copied rows are tab-separated, exactly like cells copied from a spreadsheet, so the real ApplyFast
// paste conversion handles them: 3 columns -> REF|discount|payment. Every line states its amount.
// The guided story is two parts, not a catalogue of one-off cases:
//   Story A  basic (one clean page) then multipage (~36 invoices, still free)
//   Story B  exceptions (one multi-page remittance) then Review & Reconciliation
(function (root) {
  'use strict';

  const data = root.ApplyFastDemoData || require('./invoices.js');
  const inv = data.invoices;

  const COLUMNS = {
    invoice: { key: 'ref', label: 'Invoice' },
    discount: { key: 'discount', label: 'Discount', money: true },
    paid: { key: 'paid', label: 'Amount Paid', money: true }
  };
  const REMITTANCE = [COLUMNS.invoice, COLUMNS.discount, COLUMNS.paid];

  const full = i => ({ ref: inv[i].ref, invoice: inv[i].ref, discount: 0, paid: inv[i].due });
  const withDiscount = i => ({ ref: inv[i].ref, invoice: inv[i].ref, discount: inv[i].discAvail, paid: Math.round((inv[i].due - inv[i].discAvail) * 100) / 100 });
  const line = (ref, discount, paid, extra) => Object.assign({ ref, invoice: ref, discount, paid }, extra || {});
  const miswritten = (ref, i, extra) => Object.assign({ ref, invoice: inv[i].ref, discount: 0, paid: inv[i].due }, extra || {});
  const digits = i => inv[i].ref.replace(/\D/g, '');
  // A discount larger than Disc. Avail. The payment still settles the invoice; the review flags the discount.
  const discountReview = i => {
    const discount = Math.round((inv[i].discAvail + 5) * 100) / 100;
    return { ref: inv[i].ref, invoice: inv[i].ref, discount, paid: Math.round((inv[i].due - discount) * 100) / 100 };
  };

  // Twelve invoices from each of the three list pages. Exact references, paid in full, no exceptions.
  const multipageLines = [];
  for (let page = 0; page < 3; page++) {
    const start = page * data.pageSize;
    for (let n = 0; n < 12; n++) multipageLines.push(full(start + n));
  }

  const GROUPS = [
    { id: 'story', title: 'Guided story' }
  ];

  const SCENARIOS = [
    {
      id: 'basic',
      group: 'story',
      story: 'A',
      title: 'Basic Cash Application',
      card: 'A small payment. Every invoice matches and applies in full. No exceptions.',
      intro: 'A short remittance: a few invoices, each one paid in full. Every line matches. There is nothing to correct.',
      takeaway: 'Cash application is complete. Now let\u2019s try a larger multi-page payment.',
      columns: REMITTANCE,
      lines: [full(1), full(3), full(9)]
    },
    {
      id: 'multipage',
      group: 'story',
      story: 'A',
      title: 'Larger Multi-Page Payment',
      card: 'About 36 invoices across the list. Multi-page scan and apply stay free.',
      intro: 'Now let\u2019s try a larger multi-page payment. These invoices are spread across the list, which is why scanning every page is useful.',
      introMore: 'Scanning and applying across pages is free. It is not a Premium feature and it does not need a license.',
      takeaway: 'Cash application is done. Now look at what happens when the remittance contains exceptions.',
      atScale: 'Instead of manually working through page after page, ApplyFast can scan the available pages before building the application plan.',
      multi: true,
      highlight: true,
      columns: REMITTANCE,
      lines: multipageLines
    },
    {
      id: 'exceptions',
      group: 'story',
      story: 'B',
      title: 'Exceptions and Review & Reconciliation',
      card: 'Ordinary applications and exceptions together, then the reconciliation report.',
      intro: 'This remittance was already reviewed. It mixes ordinary applications, including invoices settled with a discount, with exceptions: a partial payment, an overpayment, a discount larger than the discount available, a short payment, an unmatched invoice, a duplicate, a similar invoice number, a partial reference, and an amount that cannot be read.',
      introMore: 'Apply the cash anyway. ApplyFast writes the lines it can match and leaves the rest for Review & Reconciliation to classify. Nothing here is for you to correct, and multi-page scan stays free.',
      takeaway: 'The cash is applied. Review & Reconciliation is where the exceptions are classified, and the reconciliation report is what you hand off.',
      // Cash received is the sum of the payments Apply can write, minus $200, so one later line is a short payment.
      // 19509.49 is that figure for this seeded list (asserted against the real cash plan in the scenario tests).
      paymentReceived: 19509.49,
      entitled: true,
      multi: true,
      highlight: true,
      columns: REMITTANCE,
      lines: [
        full(28),
        withDiscount(2),
        withDiscount(8),
        line(inv[6].ref, 0, 2500),
        line(inv[9].ref, 0, 2800),
        discountReview(14),
        full(40),
        miswritten('INV-99999', 3, { paid: 180 }),
        full(11),
        full(11),
        miswritten(digits(1), 1),
        miswritten(digits(3), 3),
        miswritten(inv[5].ref, 5, { paidText: '2,5OO.00', paid: 0 }),
        full(55)
      ]
    }
  ];

  const amountOf = l => (l.paid === null ? 0 : l.paid);
  const cell = (l, col) => {
    if (!col.money) return l[col.key];
    if (l[`${col.key}Text`] !== undefined) return l[`${col.key}Text`];
    return l[col.key] === null ? '' : l[col.key].toFixed(2);
  };
  const toTsv = (lines, columns) => lines.map(l => columns.map(col => cell(l, col)).join('\t')).join('\n');

  SCENARIOS.forEach(s => {
    s.tsv = toTsv(s.lines, s.columns);
    s.totalPaid = Math.round(s.lines.reduce((sum, l) => sum + amountOf(l), 0) * 100) / 100;
    s.totalDiscount = Math.round(s.lines.reduce((sum, l) => sum + l.discount, 0) * 100) / 100;
  });

  const api = {
    groups: GROUPS,
    scenarios: SCENARIOS,
    byId: id => SCENARIOS.find(s => s.id === id),
    toTsv,
    amountOf,
    pageOf: ref => Math.floor(inv.findIndex(i => i.ref === ref) / data.pageSize) + 1
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplyFastDemoScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);