// ApplyFast Interactive Demo data. Fictional only: no real customers, companies, people,
// addresses, emails or account numbers. Deterministic (seeded) so tests and the demo agree.
// Works as a browser global (ApplyFastDemoData) and as a Node module.
(function (root) {
  'use strict';

  const SEED = 20260930;
  const COUNT = 64;
  const PAGE_SIZE = 25;
  const CUSTOMER = { id: '70101', name: 'Harborview Demo Supply Co.' };
  const UNMATCHED_REF = 'INV-10000';

  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  const round2 = n => Math.round(n * 100) / 100;
  const mdy = t => `${t.getMonth() + 1}/${t.getDate()}/${t.getFullYear()}`;

  function build() {
    const rand = rng(SEED);
    const invoices = [];
    let num = 10402;
    for (let i = 0; i < COUNT; i++) {
      const orig = round2(180 + Math.pow(rand(), 1.6) * 7600);
      invoices.push({ ref: `INV-${num}`, orig, due: orig, discAvail: 0 });
      num += 6 + Math.floor(rand() * 30);
    }
    // Some invoices were already partly paid; some offer an early-payment discount.
    invoices.forEach((inv, i) => { if (i % 7 === 4) inv.due = round2(inv.orig * (0.35 + rand() * 0.4)); });
    invoices.forEach((inv, i) => { if (i % 6 === 2) inv.discAvail = round2(inv.due * 0.02); });

    // Scenario rows, all on page 1: [index, orig, due].
    [[1, 1250.00, 1250.00], [3, 980.00, 980.00], [6, 6240.00, 6240.00], [9, 2500.00, 2500.00], [11, 2772.06, 1386.03]]
      .forEach(([i, orig, due]) => Object.assign(invoices[i], { orig, due, discAvail: 0 }));
    const similar = invoices[1];
    invoices.splice(21, 0, { ref: `${similar.ref}1`, orig: 1187.40, due: 1187.40, discAvail: 0 });

    const start = new Date(2026, 4, 4);
    invoices.forEach((inv, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + Math.round(i * 140 / (invoices.length - 1)));
      const discDate = new Date(date);
      discDate.setDate(date.getDate() + 10);
      inv.date = mdy(date);
      inv.discDate = inv.discAvail ? mdy(discDate) : '';
      inv.po = `PO-${57200 + i * 7}`;
    });
    return invoices;
  }

  const invoices = build();

  const discountRow = invoices[14];
  const discountPayment = round2(discountRow.due - discountRow.discAvail);
  const sample = {
    full: [invoices[1].ref, invoices[3].ref, invoices[11].ref],
    partial: { ref: invoices[6].ref, payment: 2500 },
    discount: { ref: discountRow.ref, discount: discountRow.discAvail, payment: discountPayment },
    similar: { ref: invoices[1].ref, sibling: invoices[21].ref },
    unmatched: UNMATCHED_REF
  };
  const sampleText = [
    sample.full[0],
    sample.full[1],
    `${sample.partial.ref}=${sample.partial.payment}`,
    sample.full[2],
    `${sample.discount.ref}|${sample.discount.discount.toFixed(2)}|${sample.discount.payment.toFixed(2)}`,
    sample.unmatched
  ].join('\n');

  const api = { customer: CUSTOMER, pageSize: PAGE_SIZE, invoices, sample, sampleText };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplyFastDemoData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
