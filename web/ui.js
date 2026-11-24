// Interactive parts of the interface. The motion comes from Lucian UX/UI Prompt (MIT License
// (c) 2026 Seokwoooo, https://lucianlabs.dev/uxui-prompt/); each function names its element.
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* #433 Checkbox, radio and switch: the switch thumb stretches while it is pressed. */
export function pressable(button) {
  button.addEventListener('pointerdown', event => { if (event.button === 0) button.classList.add('is-press'); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, () => button.classList.remove('is-press'));
  button.addEventListener('keydown', event => { if (event.key === ' ') button.classList.add('is-press'); });
  button.addEventListener('keyup', () => button.classList.remove('is-press'));
}

/* #416 Tabs: a segmented control whose thumb stretches from its leading edge, then the trailing edge catches up. */
export function segmented(root, onChange) {
  const thumb = root.querySelector('.thumb');
  const tabs = [...root.querySelectorAll('[role=radio]')];
  let current = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-checked') === 'true'));
  function place(index, direction) {
    const tab = tabs[index], width = root.clientWidth;
    thumb.style.setProperty('--tl', direction > 0 ? '.62s' : '.38s');
    thumb.style.setProperty('--tr', direction > 0 ? '.38s' : '.62s');
    thumb.style.setProperty('--l', `${tab.offsetLeft}px`);
    thumb.style.setProperty('--r', `${width - tab.offsetLeft - tab.offsetWidth}px`);
  }
  function select(index, {focus = false, silent = false} = {}) {
    const direction = index > current ? 1 : -1;
    tabs.forEach((tab, k) => { tab.setAttribute('aria-checked', String(k === index)); tab.tabIndex = k === index ? 0 : -1; });
    if (index !== current) place(index, direction);
    current = index;
    root.dataset.value = tabs[index].dataset.value;
    if (focus) tabs[index].focus({preventScroll: true});
    if (!silent) onChange?.(root.dataset.value);
  }
  tabs.forEach((tab, index) => tab.addEventListener('click', () => { if (index !== current) select(index); }));
  root.addEventListener('keydown', event => {
    const n = tabs.length;
    const to = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : null;
    if (to === null) return;
    event.preventDefault();
    select((to + n) % n, {focus: true});
  });
  thumb.style.transition = 'none';
  place(current, 1);
  void thumb.offsetWidth;
  thumb.style.transition = '';
  new ResizeObserver(() => { thumb.style.transition = 'none'; place(current, 1); void thumb.offsetWidth; thumb.style.transition = ''; }).observe(root);
  return {
    get value() { return root.dataset.value; },
    set value(value) {
      const index = tabs.findIndex(tab => tab.dataset.value === String(value));
      if (index >= 0) select(index, {silent: true});
    },
  };
}

/* #007 Play–pause morph: the triangle splits into the two pause bars. */
export function playMorph(button) {
  const [left, right] = button.querySelectorAll('polygon');
  const PLAY = [[[13, 8], [22.5, 13.6], [22.5, 26.4], [13, 32]], [[22.5, 13.6], [32, 20], [32, 20], [22.5, 26.4]]];
  const PAUSE = [[[11, 9], [17, 9], [17, 31], [11, 31]], [[23, 9], [29, 9], [29, 31], [23, 31]]];
  let shape = 0, frame = 0;
  function draw(t) {
    [left, right].forEach((polygon, k) => {
      polygon.setAttribute('points', PLAY[k].map((p, j) => {
        const q = PAUSE[k][j];
        return `${(p[0] + (q[0] - p[0]) * t).toFixed(2)},${(p[1] + (q[1] - p[1]) * t).toFixed(2)}`;
      }).join(' '));
    });
  }
  draw(0);
  return function setPlaying(playing) {
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    cancelAnimationFrame(frame);
    const from = shape, to = playing ? 1 : 0, started = performance.now(), duration = reducedMotion() ? 1 : 420;
    (function step(now) {
      const x = Math.min(1, (now - started) / duration);
      const eased = 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
      shape = from + (to - from) * eased;
      draw(shape);
      if (x < 1) frame = requestAnimationFrame(step);
    })(started);
  };
}

/* #033 Inline title editing: the title becomes a field in the same type; Enter saves, Esc cancels. */
export function inlineTitle(row, {view, pen, input, ok, no, save, canEdit = () => true}) {
  function edit() {
    if (!canEdit() || row.classList.contains('is-edit')) return;
    row.classList.add('is-edit');
    input.value = view.textContent;
    input.focus();
    input.select();
  }
  function shake() { row.classList.remove('is-shake'); void row.offsetWidth; row.classList.add('is-shake'); }
  async function done(keep) {
    if (!row.classList.contains('is-edit')) return;
    const value = input.value.trim();
    if (keep && !value) { shake(); input.focus(); return; }
    row.classList.remove('is-edit');
    if (keep && value !== view.textContent) {
      if (await save(value)) { view.classList.remove('flash'); void view.offsetWidth; view.classList.add('flash'); }
    } else if (!keep) shake();
    view.focus({preventScroll: true});
  }
  view.addEventListener('click', edit);
  pen.addEventListener('click', edit);
  ok.addEventListener('click', () => done(true));
  no.addEventListener('click', () => done(false));
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); done(true); }
    if (event.key === 'Escape') { event.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (row.isConnected && !row.contains(document.activeElement)) done(true); }, 0));
  return {edit, cancel: () => done(false)};
}

/* #435 Toast notifications: springs up from below; a thin time bar runs down and pauses on hover. */
export function toaster(element, text, dismiss, {life = 4500} = {}) {
  let timer = 0, shown = '';
  function hide() { clearTimeout(timer); element.hidden = true; shown = ''; }
  function show(message) {
    if (!message) { hide(); return; }
    if (message === shown && !element.hidden) return;
    shown = message;
    text.textContent = message;
    element.hidden = false;
    element.classList.remove('is-in');
    const bar = element.querySelector('.toast-bar');
    if (bar) bar.innerHTML = `<i style="animation-duration:${life}ms"></i>`;
    void element.offsetWidth;
    element.classList.add('is-in');
    clearTimeout(timer);
    if (life) {
      let left = life, since = Date.now();
      const arm = () => { since = Date.now(); timer = setTimeout(hide, left); };
      element.onpointerenter = () => { clearTimeout(timer); left = Math.max(500, left - (Date.now() - since)); };
      element.onpointerleave = arm;
      arm();
    }
  }
  dismiss.addEventListener('click', hide);
  return {show, hide};
}

/* #219 Circular-reveal dark mode: the new theme spreads out in a circle from the button.
   The button steps through the themes in order. */
export function themeToggle(button, {themes, get, set}) {
  const next = () => themes[(themes.indexOf(get()) + 1) % themes.length];
  function reflect() {
    button.dataset.theme = get();
    button.setAttribute('aria-label', `Theme: ${get()}. Switch to ${next()}`);
  }
  button.addEventListener('click', () => {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const root = document.documentElement;
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);
    root.style.setProperty('--theme-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    const apply = () => { set(next()); reflect(); };
    if (document.startViewTransition && !reducedMotion()) document.startViewTransition(apply); else apply();
  });
  reflect();
  return reflect;
}

/* #083 Queue bar turning into progress: indeterminate segments that turn into a fill once the end is known. */
export function progressTrack(track) {
  const fill = track.querySelector('.fill');
  return function update({fraction = 0, determinate = true, visible = true}) {
    track.hidden = !visible;
    track.classList.toggle('is-det', determinate);
    fill.style.setProperty('--p', Math.max(0, Math.min(1, fraction)).toFixed(4));
    if (determinate) track.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    else track.removeAttribute('aria-valuenow');
  };
}
