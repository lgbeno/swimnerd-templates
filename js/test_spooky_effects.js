/** Run with: node js/test_spooky_effects.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theme = path.join(__dirname, '../themes/spooky');
const html = fs.readFileSync(path.join(theme, 'EffectsOverlay.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function node() {
    return {
        innerHTML: '', children: [], style: { setProperty(key, value) { this[key] = value; } },
        replaceChildren() { this.innerHTML = ''; this.children = []; },
        append(child) { this.children.push(child); }
    };
}
function harness(search = '?autoplay=0') {
    const stage = node(), timeouts = new Map(), intervals = new Map(), listeners = {};
    let serial = 0;
    const motion = { matches: false, addEventListener(type, callback) { listeners.motion = callback; } };
    const document = { hidden: false, getElementById: () => stage, createElement: node,
        addEventListener(type, callback) { listeners[type] = callback; } };
    const context = vm.createContext({ window: {}, document, location: { search }, URLSearchParams,
        matchMedia: () => motion,
        setTimeout(callback, delay) { timeouts.set(++serial, { callback, delay }); return serial; },
        clearTimeout(id) { timeouts.delete(id); },
        setInterval(callback) { intervals.set(++serial, callback); return serial; },
        clearInterval(id) { intervals.delete(id); }
    });
    vm.runInContext(source, context);
    return { api: context.window.SpookyEffects, stage, timeouts, intervals, motion, document, listeners };
}
const h = harness();
assert.equal(h.api.catalog.length, 15);
assert.equal(new Set(h.api.catalog.map(item => item.id)).size, 15);
assert.equal(h.timeouts.size, 0, 'Controlled iframe must start empty');
assert.equal(h.intervals.size, 0);
for (const item of h.api.catalog) {
    h.api.play(item.id);
    const markup = h.stage.innerHTML + h.stage.children.map(child => child.innerHTML).join('');
    assert(markup.length > 0, `${item.id} should create artwork`);
    assert(!markup.includes('undefined'), `${item.id} should have a valid viewBox`);
    for (const [, id] of markup.matchAll(/href="#([\w-]+)"/g)) {
        assert(html.includes(`id="${id}"`), `${item.id} references missing artwork ${id}`);
    }
    assert(h.stage.children.length <= 20, 'Particle count must stay bounded');
    assert.equal(h.timeouts.size, 1, 'Replacing an effect must cancel its old cleanup');
    const [{ callback, delay }] = h.timeouts.values();
    assert(delay <= 10000);
    callback();
    assert.equal(h.stage.innerHTML, '');
    assert.equal(h.stage.children.length, 0);
}
let previous;
for (let round = 0; round < 100; round++) {
    const picks = [];
    for (let i = 0; i < 15; i++) {
        h.api.stop(); // A new heat must not reset the shuffled bag.
        const pick = h.api.playNext();
        if (!i) assert.notEqual(pick, previous, 'Avoid immediate repeats across rounds');
        picks.push(pick);
        previous = pick;
        h.api.play('witch'); // Auditions must not consume rotation entries.
    }
    assert.equal(new Set(picks).size, 15, 'Every round must include the whole cast');
}
h.api.stop();
h.listeners.visibilitychange();
h.listeners.motion();
assert.equal(h.intervals.size, 0, 'Visibility changes must not restart stopped effects');
assert.equal(h.timeouts.size, 0);
h.motion.matches = true;
h.api.start();
assert.equal(h.intervals.size, 0, 'Reduced motion suppresses automatic playback');
h.api.play('monsters');
assert.equal([...h.timeouts.values()][0].delay, 4500);
h.api.stop();
const auto = harness('');
assert.equal(auto.intervals.size, 1);
auto.document.hidden = true;
auto.listeners.visibilitychange();
assert.equal(auto.intervals.size, 0);
assert.equal(auto.timeouts.size, 0);
console.log('PASS: 15 renderers, referenced artwork, cleanup, 100 shuffled rounds, auditions, visibility, reduced motion.');

// Exercise the preview with fake time: only new events trigger a cameo.
const preview = fs.readFileSync(path.join(theme, 'Preview.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let now = 0, tick, plays = 0;
const elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, Object.assign(node(), {
        listeners: {}, addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
        contentDocument: { getElementById: () => ({ classList: { add() {} } }) },
        contentWindow: { processAllHeaderDataWithRunner() {}, processSpookyLaneData() {},
            SpookyEffects: { catalog: [{ id: 'ghosts', name: 'Ghost parade' }], stop() {},
                playNext() { plays++; return 'ghosts'; }, play() { plays++; } } }
    }));
    return elements.get(id);
}
const controls = ['effect-select', 'play-effect', 'effects-toggle'].map(element);
const context = vm.createContext({
    document: { getElementById: element, querySelector: element, querySelectorAll: () => controls, createElement: node },
    ResizeObserver: class { observe() {} }, performance: { now: () => now },
    setInterval(callback) { tick = callback; return 1; }, clearInterval() { tick = null; }
});
vm.runInContext(preview, context);
element('effects').listeners.load.forEach(callback => callback());
const run = code => vm.runInContext(code, context);
run('showDemoLineup()'); assert.equal(plays, 0);
run('nextEvent()'); assert.equal(plays, 1); assert.equal(run('eventNumber'), 13);
run('showDemoLineup()'); assert.equal(plays, 1); assert.equal(run('heat'), 2);
run('runDemoRace()'); assert.equal(run('heat'), 2);
now = 20000; tick(); assert.equal(plays, 1); assert(controls.every(control => control.disabled));
run('nextEvent()'); assert.equal(plays, 2); assert.equal(run('heat'), 1);
console.log('PASS: event-only trigger, silent heat changes/finishes, next-event reset.');
