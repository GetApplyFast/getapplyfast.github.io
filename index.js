// ApplyFast website: mobile menu, workflow step viewer and the illustrative scale estimate.
(function () {
  'use strict';

  // Mobile menu
  const menuBtn = document.getElementById('menuBtn');
  const navLinks = document.getElementById('navLinks');
  if (menuBtn && navLinks) {
    const setOpen = open => {
      navLinks.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => setOpen(menuBtn.getAttribute('aria-expanded') !== 'true'));
    navLinks.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && navLinks.classList.contains('is-open')) { setOpen(false); menuBtn.focus(); }
    });
  }

  // Workflow steps: each step shows its screenshot from the demo.
  const tabs = Array.from(document.querySelectorAll('.steps [role="tab"]'));
  const panel = document.getElementById('workflowPanel');
  const img = document.getElementById('workflowImg');
  const caption = document.getElementById('workflowCaption');
  function select(tab, focus) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const name = tab.dataset.img;
    img.srcset = `images/site/${name}-800.webp 800w, images/site/${name}-1440.webp 1440w`;
    img.src = `images/site/${name}-1440.webp`;
    img.alt = tab.dataset.alt;
    caption.textContent = tab.dataset.caption;
    panel.setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', e => {
      const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });
  });

  // Illustrative scale estimate: the visitor's own assumption multiplied out in plain sight
  // (invoices x seconds per invoice), the same formula as the demo's time-savings story.
  const num = n => n.toLocaleString('en-US');
  function duration(totalSeconds) {
    if (totalSeconds < 3600) {
      const m = Math.round(totalSeconds / 60);
      return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
    }
    return `${(Math.round(totalSeconds / 360) / 10).toFixed(1)} hours`;
  }
  const estimator = document.getElementById('estimator');
  if (estimator) {
    const seconds = document.getElementById('scaleSeconds');
    const update = () => {
      const volume = Number((estimator.querySelector('input[name="scaleVolume"]:checked') || {}).value || 1000);
      const secs = Number(seconds.value);
      const total = volume * secs;
      document.getElementById('scaleRepeat').textContent = `${num(volume)} times`;
      document.getElementById('scaleFormula').textContent = `${num(volume)} invoices × ${secs} seconds = ${num(total)} seconds ≈ ${duration(total)}`;
      document.getElementById('scaleEffort').textContent = `~${duration(total)}`;
      document.getElementById('scaleDots').innerHTML = '<i></i>'.repeat(Math.ceil(volume / 10));
    };
    estimator.addEventListener('change', update);
    update();
  }
})();
