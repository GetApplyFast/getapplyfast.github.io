// ApplyFast Interactive Demo scenarios: fictional customer remittances, as the customer sent them.
// Copied rows are tab-separated, exactly like cells copied from a spreadsheet, so the real ApplyFast
// paste conversion handles them: 1 column -> REF (Amount Due), 2 -> REF=payment, 3 -> REF|discount|payment.
(function (root) {
  'use strict';

  const data = root.ApplyFastDemoData || require('./invoices.js');
  const inv = data.invoices;

  const COLUMNS = {
    invoice: { key: 'ref', label: 'Invoice' },
    po: { key: 'ref', label: 'Customer PO #' },
    discount: { key: 'discount', label: 'Discount', money: true },
    paid: { key: 'paid', label: 'Amount Paid', money: true }
  };
  const REMITTANCE = [COLUMNS.invoice, COLUMNS.discount, COLUMNS.paid];

  // ref: what the remittance says; invoice: the open invoice it should settle; paid: null = Amount Due.
  const full = i => ({ ref: inv[i].ref, invoice: inv[i].ref, discount: 0, paid: inv[i].due });
  const refOnly = i => ({ ref: inv[i].ref, invoice: inv[i].ref, discount: 0, paid: null });
  const byPo = i => ({ ref: inv[i].po, invoice: inv[i].ref, discount: 0, paid: inv[i].due });
  const withDiscount = i => ({ ref: inv[i].ref, invoice: inv[i].ref, discount: inv[i].discAvail, paid: Math.round((inv[i].due - inv[i].discAvail) * 100) / 100 });
  const line = (ref, discount, paid) => ({ ref, invoice: ref, discount, paid });
  // A remittance line that should settle invoice i but was written differently by the customer.
  const miswritten = (ref, i, extra) => Object.assign({ ref, invoice: inv[i].ref, discount: 0, paid: inv[i].due }, extra);
  const digits = i => inv[i].ref.replace(/\D/g, '');
  const fmtMoney = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const GROUPS = [
    { id: 'basic', title: 'Basic application' },
    { id: 'variations', title: 'Payment variations' },
    { id: 'exceptions', title: 'Exceptions' },
    { id: 'automation', title: 'Automation' }
  ];

  const SCENARIOS = [
    {
      id: 'basic',
      title: 'Your first remittance',
      intro: 'A normal remittance: four invoices paid in full and one with an early-payment discount.',
      columns: REMITTANCE,
      lines: [full(1), full(3), full(9), full(11), withDiscount(14)]
    },
    {
      id: 'full',
      group: 'basic',
      title: 'Apply in Full',
      card: 'Just paste the invoice references. ApplyFast applies each remaining Amount Due.',
      intro: 'Just paste the invoice references.',
      introMore: 'By default, ApplyFast applies each invoice’s remaining Amount Due.',
      takeaway: 'No amounts were needed: each invoice received its remaining Amount Due.',
      columns: [COLUMNS.invoice],
      lines: [refOnly(1), refOnly(3), refOnly(9)]
    },
    {
      id: 'other',
      group: 'basic',
      title: 'Other References',
      card: 'The remittance lists the customer’s PO numbers instead of invoice numbers.',
      intro: 'ApplyFast can work with the references already available in your remittance.',
      introMore: 'This customer quoted their PO numbers. ApplyFast matches them against the PO/Check Number column.',
      takeaway: 'Each PO number was matched to its invoice and applied.',
      columns: [COLUMNS.po, COLUMNS.paid],
      lines: [byPo(5), byPo(13), byPo(17)]
    },
    {
      id: 'discount',
      group: 'variations',
      title: 'Discount',
      card: 'Early-payment discounts come through in the Discount column.',
      intro: 'The customer took early-payment discounts. ApplyFast writes both the Payment and the Disc. Taken for each line.',
      takeaway: 'Payment and Disc. Taken were written together for every discounted invoice.',
      columns: REMITTANCE,
      lines: [withDiscount(8), withDiscount(14), withDiscount(20)]
    },
    {
      id: 'partial',
      group: 'variations',
      title: 'Partial Payment',
      card: 'The customer pays only part of an invoice.',
      intro: 'Sometimes the customer pays only part of an invoice.',
      takeaway: 'Only the amount paid was applied. The rest of the invoice stays open.',
      columns: REMITTANCE,
      lines: [line(inv[6].ref, 0, 2500.00)]
    },
    // Exception scenarios: the real ApplyFast review flags the problem lines; the visitor fixes them
    // in the Payment References box and reviews again. `resolved` is the corrected remittance.
    {
      id: 'unmatched',
      group: 'exceptions',
      title: 'Unmatched Invoice',
      card: 'The remittance lists an invoice number that is not open for this customer.',
      intro: 'ApplyFast doesn’t blindly apply everything. It shows you what it couldn’t match before anything is written.',
      takeaway: 'You checked the unmatched reference, corrected it and reviewed again before anything was saved.',
      issue: {
        headline: 'Reference not found.',
        explain: 'ApplyFast found a reference it couldn’t match. Check the remittance and correct the invoice reference before applying.',
        action: 'Correct the invoice reference in the remittance, then paste the corrected remittance and review again.',
        why: `The customer’s AR contact confirms the ${fmtMoney(inv[3].due)} payment was for ${inv[3].ref}.`,
        fixes: [{ col: 'ref', from: 'INV-99999', to: inv[3].ref }]
      },
      columns: REMITTANCE,
      lines: [full(1), miswritten('INV-99999', 3)],
      resolved: [full(1), full(3)]
    },
    {
      id: 'duplicate',
      group: 'exceptions',
      title: 'Duplicate Reference',
      card: 'The same invoice appears twice on the remittance.',
      intro: 'The customer listed the same invoice twice. ApplyFast flags both lines instead of guessing which one is right.',
      takeaway: 'You removed the duplicate line and reviewed again, so the invoice was applied once.',
      issue: {
        headline: 'Duplicate reference detected.',
        explain: 'The same reference appears twice, so ApplyFast holds both lines back instead of guessing.',
        action: 'Remove the duplicate from the remittance, then paste the corrected remittance and review again.',
        why: `${inv[3].ref} was paid once.`,
        fixes: [{ remove: inv[3].ref }]
      },
      columns: REMITTANCE,
      lines: [full(3), full(3), full(11)],
      resolved: [full(3), full(11)]
    },
    {
      id: 'similar',
      group: 'exceptions',
      title: 'Similar Invoice Numbers',
      card: 'The remittance gives a bare number that fits two nearly identical invoices.',
      intro: `This customer has two open invoices with similar numbers: ${inv[1].ref} and ${inv[21].ref}. The remittance just says ${digits(1)}.`,
      takeaway: `Only ${inv[1].ref} was applied. ${inv[21].ref} was left untouched.`,
      similar: { ref: inv[1].ref, sibling: inv[21].ref },
      issue: {
        headline: 'Similar invoice numbers detected.',
        explain: `Similar-looking references should be verified before applying. ${digits(1)} fits both ${inv[1].ref} and ${inv[21].ref}, so ApplyFast won’t guess.`,
        action: 'Verify the invoice reference in the remittance, then paste the corrected reference and review again.',
        why: `The amount paid, ${fmtMoney(inv[1].due)}, is the balance of ${inv[1].ref}.`,
        fixes: [{ col: 'ref', from: digits(1), to: inv[1].ref }]
      },
      columns: REMITTANCE,
      lines: [miswritten(digits(1), 1)],
      resolved: [full(1)]
    },
    {
      id: 'exceptions',
      group: 'exceptions',
      title: 'Exceptions / Issues',
      card: 'A messy remittance: a number without its prefix and a mistyped amount.',
      intro: 'Real remittances are messy. This one has an invoice number without its INV- prefix and an amount typed with a letter O instead of zeros.',
      takeaway: 'You fixed each flagged line and reviewed again. The clean remittance was applied; nothing was guessed.',
      issue: {
        headline: 'Some lines need attention.',
        explain: 'ApplyFast lists each problem line with its reason and applies nothing it isn’t sure about.',
        action: 'Correct each flagged line in the remittance, then paste the corrected remittance and review again.',
        why: `${digits(3)} is ${inv[3].ref} without its prefix, and 2,5OO.00 was typed with the letter O.`,
        fixes: [{ col: 'ref', from: digits(3), to: inv[3].ref }, { col: 'paid', from: '2,5OO.00', to: '2500.00' }]
      },
      columns: REMITTANCE,
      lines: [full(1), full(5), miswritten(digits(3), 3), miswritten(inv[9].ref, 9, { paidText: '2,5OO.00' })],
      resolved: [full(1), full(5), full(3), full(9)]
    },
    {
      id: 'multipage',
      group: 'automation',
      title: 'Multiple Pages',
      card: 'The invoices are spread across several pages of the list.',
      intro: 'What if the invoices aren’t all on the current page?',
      takeaway: 'ApplyFast scanned every page, then applied each invoice on the page where it lives.',
      atScale: 'Instead of manually working through page after page, ApplyFast can scan the available pages before building the application plan.',
      multi: true,
      premium: true,
      featured: {
        summary: 'Scan and apply across all pages',
        question: 'Working with multiple invoice pages?',
        benefit: 'Scan them all before applying.',
        scale: 'Especially useful when payments span multiple pages.'
      },
      columns: REMITTANCE,
      lines: [full(2), full(30), full(47), full(58)]
    }
  ];

  const invoiceOf = ref => inv.find(i => i.ref === ref);
  const amountOf = l => (l.paid === null ? (invoiceOf(l.invoice) || { due: 0 }).due : l.paid);
  // `paidText` is the amount exactly as the customer typed it (possibly not a valid amount).
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
