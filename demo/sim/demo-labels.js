// ApplyFast Interactive Demo: tags the real panel's mode options with how they are sold in the
// real extension. Runs after content.js and waits for the panel to appear.
(function () {
  'use strict';

  const TAGS = {
    single: ['demo-tag-free', 'Free in the real extension'],
    multi: ['demo-tag-licensed', 'Licensed feature in the real extension']
  };

  function tagModes() {
    let found = 0;
    Object.keys(TAGS).forEach(mode => {
      const input = document.querySelector(`#applyFastBox input[name="afMode"][value="${mode}"]`);
      if (!input) return;
      found++;
      const host = input.nextElementSibling;
      if (!host || host.querySelector('.demo-tag')) return;
      const tag = document.createElement('em');
      tag.className = `demo-tag ${TAGS[mode][0]}`;
      tag.textContent = TAGS[mode][1];
      host.appendChild(tag);
    });
    return found === Object.keys(TAGS).length;
  }

  if (tagModes()) return;
  const observer = new MutationObserver(() => { if (tagModes()) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
})();
