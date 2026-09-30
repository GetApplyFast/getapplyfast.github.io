// ApplyFast Interactive Demo spotlight: dims the demo and leaves one or more targets bright, with a
// border (and optionally a pulse) around each. Targets may live in this page or in the same-origin
// simulated page iframe. The overlay never takes pointer events, so every target stays clickable.
//
//   const spot = ApplyFastDemoSpotlight.create();
//   spot.show('paste', [{ key: 'paste', resolve: () => el, ring: 'pulse' }, { key: 'step', resolve: () => li, ring: 'none' }]);
//   spot.hide();
//
// ring: 'pulse' (the thing to use next), 'static' (context), 'warn' (an exception to review),
// 'none' (just kept bright) or 'secondary' (half-dimmed, visible but not the focus).
(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PAD = 6;

  // options.top(): viewport y where dimming starts, so a persistent header above it stays untouched.
  function create(options) {
    const opts = options || {};
    const layer = document.createElement('div');
    layer.id = 'demoSpotlight';
    layer.className = 'demo-spotlight';
    layer.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.innerHTML = '<defs><mask id="demoSpotlightMask" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="100%" height="100%" fill="#fff"/><g class="demo-spotlight-holes"></g></mask></defs>' +
      '<rect class="demo-spotlight-dim" x="0" y="0" width="100%" height="100%" mask="url(#demoSpotlightMask)"/>';
    layer.appendChild(svg);
    document.body.appendChild(layer);
    const holes = svg.querySelector('.demo-spotlight-holes');

    let name = '';
    let specs = [];
    let raf = 0;
    const shapes = new Map();

    // The target's box in this page's viewport, clipped to the frame or scroll area that shows it.
    function boxOf(el) {
      if (!el || !el.isConnected) return null;
      let r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      let clip = null;
      const win = el.ownerDocument.defaultView;
      if (win && win !== window) {
        const frame = win.frameElement;
        if (!frame) return null;
        const f = frame.getBoundingClientRect();
        box = { left: box.left + f.left + frame.clientLeft, top: box.top + f.top + frame.clientTop, right: box.right + f.left + frame.clientLeft, bottom: box.bottom + f.top + frame.clientTop };
        clip = f;
      } else {
        const area = el.closest('[data-spotlight-clip]');
        if (area && area !== el) clip = area.getBoundingClientRect();
      }
      box = { left: box.left - PAD, top: box.top - PAD, right: box.right + PAD, bottom: box.bottom + PAD };
      if (clip) box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) };
      if (box.right - box.left < 4 || box.bottom - box.top < 4) return null;
      return box;
    }

    function shapeFor(key, ring) {
      let s = shapes.get(key);
      if (!s) {
        const hole = document.createElementNS(SVG_NS, 'rect');
        hole.setAttribute('rx', '8');
        hole.setAttribute('fill', ring === 'secondary' ? '#8C8C8C' : '#000');
        holes.appendChild(hole);
        const outline = document.createElement('div');
        outline.className = 'demo-spotlight-ring';
        outline.dataset.key = key;
        layer.appendChild(outline);
        s = { hole, outline };
        shapes.set(key, s);
      }
      s.outline.dataset.ring = ring;
      return s;
    }

    function removeShape(key) {
      const s = shapes.get(key);
      if (!s) return;
      s.hole.remove();
      s.outline.remove();
      shapes.delete(key);
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      const top = Math.max(0, Math.round(opts.top ? opts.top() : 0));
      if (layer.style.top !== `${top}px`) layer.style.top = `${top}px`;
      const shown = [];
      let primary = false;
      specs.forEach(spec => {
        let el = null;
        try { el = spec.resolve(); } catch (e) { el = null; }
        const full = boxOf(el);
        const box = full && full.bottom > top + 4 ? Object.assign({}, full, { top: Math.max(full.top, top) - top, bottom: full.bottom - top }) : null;
        if (!box) { removeShape(spec.key); return; }
        const s = shapeFor(spec.key, spec.ring);
        const w = box.right - box.left, h = box.bottom - box.top;
        s.hole.setAttribute('x', box.left);
        s.hole.setAttribute('y', box.top);
        s.hole.setAttribute('width', w);
        s.hole.setAttribute('height', h);
        Object.assign(s.hole.style, { x: `${box.left}px`, y: `${box.top}px`, width: `${w}px`, height: `${h}px` });
        s.outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
        s.outline.style.width = `${w}px`;
        s.outline.style.height = `${h}px`;
        shown.push(spec.key);
        if (spec.ring === 'pulse' || spec.ring === 'static' || spec.ring === 'warn') primary = true;
      });
      // Nothing to point at (target scrolled away or not rendered yet): no dimming.
      const visible = primary;
      if (layer.classList.contains('is-on') !== visible) layer.classList.toggle('is-on', visible);
      const keys = visible ? shown.join(' ') : '';
      if (layer.dataset.target !== keys) layer.dataset.target = keys;
    }

    function show(spotName, list) {
      if (spotName === name && list.length === specs.length && list.every((s, i) => s.key === specs[i].key && s.ring === specs[i].ring)) {
        specs = list;
        return;
      }
      name = spotName;
      specs = list.map(s => Object.assign({ ring: 'pulse' }, s));
      const keys = new Set(specs.map(s => s.key));
      Array.from(shapes.keys()).forEach(k => { if (!keys.has(k)) removeShape(k); });
      layer.dataset.name = name;
      layer.hidden = false;
      if (!raf) frame();
    }

    function hide() {
      name = '';
      specs = [];
      cancelAnimationFrame(raf);
      raf = 0;
      Array.from(shapes.keys()).forEach(removeShape);
      layer.classList.remove('is-on');
      layer.dataset.name = '';
      layer.dataset.target = '';
      layer.hidden = true;
    }

    return { show, hide, get name() { return name; } };
  }

  root.ApplyFastDemoSpotlight = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
