import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

function harness() {
  const source = readFileSync(new URL('../views/ResumeEditor/hooks/useMobileEditorDrawer.ts', import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  const slots = []; let cursor = 0; let effects = []; let dirty = false;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const timers = new Map(); let timerId = 0; const listeners = new Map();
  const browser = { innerWidth: 430, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(name => name === 'react' ? react : { waitForNextFrame: fn => { const id = browser.setTimeout(fn); return () => browser.clearTimeout(id); } }, module, module.exports, browser);
  let result; const container = { style: { overflow: 'auto' } }; let selected = 'experience';
  const options = { ownerKey: 'user-a:resume-a', mobileDrawerOpenRequest: 0, scrollContainerRef: { current: container }, setSidebarTab: tab => { selected = tab; } };
  const render = () => { let count = 0; do { dirty = false; cursor = 0; effects = []; result = module.exports.useMobileEditorDrawer(options); effects.forEach(fn => fn()); assert.ok(++count < 20, 'hook must converge'); } while (dirty); return result; };
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); return render(); };
  return { render, flush, options, container, browser, listeners, get selected() { return selected; } };
}

test('workbench reopens its page and subtab, and lazily retains assistant mount state', () => {
  const h = harness(); let state = h.render();
  assert.equal(state.page, 'information'); assert.equal(state.hasOpenedAssistant, false);
  state.open('analysis'); state = h.flush(); state.setReportTab('resume'); state = h.render();
  state.close(); state = h.flush(); assert.equal(state.isOpen, false);
  state.open(); state = h.flush(); assert.equal(state.page, 'analysis'); assert.equal(state.reportTab, 'resume');
  assert.equal(h.container.style.overflow, 'hidden');
  state.open('assistant'); state = h.flush(); assert.equal(state.hasOpenedAssistant, true);
  state.open('information'); state = h.flush(); assert.equal(state.hasOpenedAssistant, true);
});

test('owner or resume change resets context and a pending close cannot hide a reopened workbench', () => {
  const h = harness(); let state = h.render(); state.open('assistant'); state = h.flush();
  state.close(); state.open('analysis'); state = h.flush(); assert.equal(state.isOpen, true); assert.equal(state.page, 'analysis');
  h.options.ownerKey = 'user-b:resume-a'; state = h.render();
  assert.equal(state.isOpen, false); assert.equal(state.hasOpened, false); assert.equal(state.hasOpenedAssistant, false); assert.equal(state.reportTab, 'jd'); assert.equal(h.container.style.overflow, 'auto');
});

test('explicit experience request overrides last page and desktop resize dismisses the mobile surface', () => {
  const h = harness(); let state = h.render(); state.open('analysis'); state = h.flush();
  h.options.mobileDrawerOpenRequest = 1; state = h.render(); state = h.flush();
  assert.equal(state.page, 'information'); assert.equal(h.selected, 'experience');
  h.browser.innerWidth = 1024; h.listeners.get('resize')(); state = h.render(); assert.equal(state.isOpen, false);
});
