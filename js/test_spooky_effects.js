/** Run with: node js/test_spooky_effects.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const theme = path.join(__dirname, '../themes/spooky');
const html = fs.readFileSync(path.join(theme, 'EffectsOverlay.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function node() {
    return { innerHTML: '', children: [], style: { setProperty(key, value) { this[key] = value; } },
        replaceChildren() { this.innerHTML = ''; this.children = []; }, append(child) { this.children.push(child); } };
}
function harness(search = '?preview=1') {
    const stage = node(), timeouts = new Map(), intervals = new Map();
    let serial = 0, onData;
    const motion = { matches: false };
    const document = { hidden: false, getElementById: () => stage, createElement: node };
    const context = vm.createContext({ window: {}, document, location: { search }, URLSearchParams,
        matchMedia: () => motion, SwimOverlay: { init(options) { onData = options.onData; } },
        setTimeout(callback, delay) { timeouts.set(++serial, { callback, delay }); return serial; },
        clearTimeout(id) { timeouts.delete(id); },
        setInterval(callback) { intervals.set(++serial, callback); return serial; }, clearInterval(id) { intervals.delete(id); }
    });
    vm.runInContext(source, context);
    return { api: context.window.SpookyEffects, stage, timeouts, intervals, motion, document,
        feed(data) { return onData(data); }, connected: () => !!onData,
        finish() { for (const [id, timer] of timeouts) { timeouts.delete(id); timer.callback(); } } };
}
const packet = (event, state = 2, heat = 1) => ({ swimming: {
    EventNumber: event, HeatNumber: heat, ScoreboardCurrentState: state, RunningTime: state === 3 ? '0:03.2' : '0:00.0'
} });
const h = harness();
assert.equal(h.connected(), false);
assert.equal(h.api.catalog.length, 15);
assert.equal(h.api.playNext(), null, 'No animation until timer state is known');
h.api.processData(packet(12));
assert.equal(h.timeouts.size, 0, 'Initial event is a baseline, not a trigger');
for (const item of h.api.catalog) {
    assert.equal(h.api.play(item.id), true);
    const markup = h.stage.innerHTML + h.stage.children.map(child => child.innerHTML).join('');
    assert(markup.length > 0 && !markup.includes('undefined'));
    for (const [, id] of markup.matchAll(/href="#([\w-]+)"/g)) assert(html.includes(`id="${id}"`));
    assert(h.stage.children.length <= 20);
    assert.equal(h.timeouts.size, 1);
    assert.equal(h.api.play('witch'), false, 'Do not replace an active cameo');
    assert.equal(h.api.playNext(), null);
    h.finish();
    assert.equal(h.stage.innerHTML, '');
    assert.equal(h.stage.children.length, 0);
}
let previous;
for (let round = 0; round < 100; round++) {
    const picks = [];
    for (let i = 0; i < 15; i++) {
        h.api.stop();
        const pick = h.api.playNext();
        if (!i) assert.notEqual(pick, previous);
        picks.push(pick); previous = pick;
        h.api.stop(); h.api.play('witch'); // Auditions do not consume rotation entries.
    }
    assert.equal(new Set(picks).size, 15);
}
h.api.stop();
h.motion.matches = true; assert.equal(h.api.playNext(), null);
h.motion.matches = false; h.document.hidden = true; assert.equal(h.api.playNext(), null);
console.log('PASS: 15 renderers, cleanup, overlap guard, 100 shuffled rounds, reduced motion, hidden source.');

const live = harness('');
assert(live.connected(), 'Standalone OBS source must connect to scoreboard data');
assert.equal(live.intervals.size, 0, 'No periodic animations');
live.feed(packet(12));
assert.equal(live.timeouts.size, 0);
live.feed(packet(' 012 ')); // Numeric/string/padding variations are not new events.
live.feed(packet(12, 2, 2));
assert.equal(live.timeouts.size, 0);
assert(live.feed(packet(13)));
const runningTimer = [...live.timeouts.keys()][0];
const runningMarkup = live.stage.innerHTML;
live.feed(packet(13, '3'));
assert(live.timeouts.has(runningTimer), 'Starting timer must preserve animation cleanup');
assert.equal(live.stage.innerHTML, runningMarkup, 'Race start must not clear current artwork');
assert.equal(live.api.play('ghosts'), false);
live.finish();
assert.equal(live.api.play('ghosts'), false, 'Still interlocked after active animation ends');
assert.equal(live.api.start(), null, 'Compatibility start entry point must obey the interlock');
assert.equal(live.feed(packet(14, 3)), null, 'New event while running is blocked');
assert.equal(live.feed(packet(14, 2)), null, 'Do not queue blocked event for timer stop');
for (let i = 0; i < 100; i++) live.feed(packet(14, 2, 3));
assert.equal(live.timeouts.size, 0, 'Repeated packets and heats cannot retrigger');
assert(live.feed(packet(15, '2')));
live.finish();
for (const state of [undefined, null, '', 'unknown']) {
    live.feed({ swimming: { EventNumber: 16, ScoreboardCurrentState: state } });
    assert.equal(live.api.play('ghosts'), false, 'Unknown timer state must fail closed');
}
assert.equal(live.feed(packet(16, 2)), null);
live.feed({ swimming: { EventNumber: '', ScoreboardCurrentState: 3 } });
assert.equal(live.api.playNext(), null, 'Blank event must still update running interlock');
live.feed(packet(16, 2));
assert(live.feed(packet(17, 2)));
live.finish();
live.document.hidden = true;
assert.equal(live.feed(packet(18)), null);
live.document.hidden = false;
assert.equal(live.feed(packet(18)), null, 'Unhiding must not replay a missed event');
assert.equal(live.intervals.size, 0);
const joinedMidRace = harness('');
joinedMidRace.feed(packet(30, 3));
joinedMidRace.feed(packet(30, 2));
assert.equal(joinedMidRace.timeouts.size, 0);
assert(joinedMidRace.feed(packet(31, 2)));
console.log('PASS: live feed wiring, timer interlock, natural completion, duplicate packets, heat changes, dropped blocked transitions.');

// Preview uses the actual effects controller, including its timer interlock.
const preview = fs.readFileSync(path.join(theme, 'Preview.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let now = 0, tick;
const effects = harness(), elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, Object.assign(node(), {
        listeners: {}, addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
        contentDocument: { getElementById: () => ({ classList: { add() {} } }) },
        contentWindow: { processAllHeaderDataWithRunner() {}, processSpookyLaneData() {}, SpookyEffects: effects.api }
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
run('showDemoLineup()'); assert.equal(effects.timeouts.size, 0);
run('nextEvent()'); assert.equal(effects.timeouts.size, 1);
const timerId = [...effects.timeouts.keys()][0];
run('runDemoRace()'); assert(effects.timeouts.has(timerId), 'Preview race start must not kill cameo');
assert(controls.every(control => control.disabled));
assert.equal(effects.api.play('witch'), false);
effects.finish();
now = 20000; tick(); assert.equal(effects.timeouts.size, 0);
run('showDemoLineup()'); assert.equal(effects.timeouts.size, 0);
run('nextEvent()'); assert.equal(effects.timeouts.size, 1);
console.log('PASS: preview and OBS share interlock; races preserve active cameos; finishes and heats remain silent.');

// The smaller header mascot must respect the same race-start interlock.
const headerSource = fs.readFileSync(path.join(theme, 'HeaderOverlay.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let headerLastEvent, headerStarts = 0;
const runner = { classList: { add() { headerStarts++; }, remove() {} }, offsetWidth: 10 };
const headerContext = vm.createContext({
    document: { getElementById: () => runner }, location: { search: '?preview=1' }, URLSearchParams,
    matchMedia: () => ({ matches: false }), setTimeout() {}, SwimOverlay: {},
    processHeaderData(data) {
        const next = data.swimming.EventNumber;
        if (headerLastEvent !== undefined && next !== headerLastEvent) headerContext.SwimOverlay.onEventChange();
        headerLastEvent = next;
    }
});
vm.runInContext(headerSource, headerContext);
vm.runInContext('processTimerInHeader = () => {};', headerContext);
headerContext.location.search = '';
headerContext.processAllHeaderDataWithRunner(packet(1)); assert.equal(headerStarts, 0);
headerContext.processAllHeaderDataWithRunner(packet(2, 3)); assert.equal(headerStarts, 0);
headerContext.processAllHeaderDataWithRunner(packet(2, 2)); assert.equal(headerStarts, 0);
headerContext.processAllHeaderDataWithRunner(packet(3, 2)); assert.equal(headerStarts, 1);
headerContext.processAllHeaderDataWithRunner(packet(3, 3));
assert.equal(vm.runInContext('runnerRunning', headerContext), true, 'Header mascot must finish naturally');
console.log('PASS: header mascot obeys timer interlock and does not start on initial connection.');
