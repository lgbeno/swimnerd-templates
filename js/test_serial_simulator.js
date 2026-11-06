'use strict';
// The simulated ports must produce what the decoders expect. This checks the simulator
// against this project's decoders; it says nothing about the real serial links.
const assert = require('node:assert/strict');
const { MEET, TICK, LINEUP, AFTER, RESULTS, LINE_BUDGET, TimerSource, MeetManager } = require('./bridge/simulator');
const { Decoder, payload } = require('./cts6/decoder');
const { StreamParser, RosterStore, request } = require('./bridge/genser');
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
const shown = cs => `${Math.floor(cs / 6000)}:${String(Math.floor(cs % 6000 / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
/** Feed ticks [from, to) into a decoder, timestamped as they would arrive. */
function run(source, decoder, to) {
    while (source.tick < to) { const at = source.tick * TICK; decoder.feed(source.step(), at); }
    return decoder.snapshot((to - 1) * TICK);
}

test('one tenth of traffic fits a 9600 baud line, and the clock never skips', () => {
    const source = new TimerSource(), d = new Decoder();
    let previous = null, steps = 0, sequence = 0;
    for (let tick = 0; tick < source.cycle; tick++) {
        const state = source.state(tick), bytes = source.step();
        assert(bytes.length <= LINE_BUDGET, `tick ${tick} sends ${bytes.length} bytes`);
        for (const b of bytes) {
            d.feed([b], tick * TICK);
            if (d.clockSequence === sequence) continue;
            sequence = d.clockSequence;
            const tenths = Math.round(d.clockSeconds * 10);
            if (previous !== null && tenths > previous) { assert.equal(tenths - previous, 1); steps++; }
            previous = tenths;
        }
        if (state.phase === 'race' && tick % 10 === 5 && state.tenths > 5) assert.equal(d.snapshot(tick * TICK).state, 'running');
    }
    assert.equal(sequence, source.cycle);                        // one clock block per tenth, committed within its own tick
    assert.equal(steps, source.heats.reduce((n, h) => n + h.race - 1, 0));
    assert.equal(d.orphans, 0);
});
test('each heat decodes as reset, then running, then the planned places and times', () => {
    const source = new TimerSource(), d = new Decoder();
    assert.deepEqual(source.heats.map(h => [h.event, h.heat]), MEET.flatMap(e => e.heats.map((_, i) => [e.event, i + 1])));
    for (const h of source.heats) {
        let s = run(source, d, h.start + LINEUP);
        assert.equal(s.event, h.event); assert.equal(s.heat, h.heat); assert.equal(s.clock, '0:00.0'); assert.equal(s.state, 'reset');
        assert(s.lanes.every(l => !l.time && !l.place), 'last heat\'s results are gone at the lineup');
        assert.deepEqual(s.lanes.map(l => l.displayedLane), ['1', '2', '3', '4', '5', '6', '7', '8', '', '']);
        s = run(source, d, h.start + LINEUP + 30);               // three seconds in: everyone still swimming
        assert.equal(s.state, 'running'); assert.equal(s.clock, '0:02.9');
        h.lanes.forEach((l, i) => assert.equal(s.lanes[i].followsClock, !!l));
        s = run(source, d, h.start + h.ticks);                   // end of the results hold
        assert.equal(s.state, 'unknown');                        // a stopped clock proves nothing
        assert.equal(Math.round(d.clockSeconds * 10), h.race - 1);
        h.lanes.forEach((l, i) => {
            assert.equal(s.lanes[i].time, l ? shown(l.final) : ''); assert.equal(s.lanes[i].place, l ? String(l.place) : '');
        });
        assert.deepEqual(h.lanes.filter(Boolean).map(l => l.place).sort(), h.lanes.filter(Boolean).map((_, i) => i + 1));
        assert.equal(h.ticks, LINEUP + h.race + RESULTS);
        assert.equal(h.race, Math.ceil(Math.max(...h.lanes.filter(Boolean).map(l => l.final)) / 10) + AFTER);
    }
    assert.equal(source.tick, source.cycle);
    const again = run(source, d, source.cycle + LINEUP);          // the meet repeats
    assert.equal(again.event, MEET[0].event); assert.equal(again.heat, 1); assert.equal(again.state, 'reset');
});
test('a split shows a time without a place, then the lane returns to the running clock', () => {
    const source = new TimerSource(), d = new Decoder(), h = source.heats[0];
    const i = h.lanes.findIndex(Boolean), l = h.lanes[i], touch = h.start + LINEUP + Math.ceil(l.split / 10);
    let s = run(source, d, touch + 5);
    assert.equal(s.lanes[i].time, shown(l.split)); assert.equal(s.lanes[i].place, ''); assert.equal(s.lanes[i].followsClock, false);
    const sw = payload(s, new Map(), { placedTimesAreFinal: true }).swimming.LaneAthleteTeam[i];
    assert.equal(sw.SplitTime, shown(l.split)); assert.equal(sw.FinalTime, '');
    s = run(source, d, touch + 60);
    assert.equal(s.lanes[i].followsClock, true); assert.equal(s.lanes[i].time, '');
});
test('joining mid-meet picks the stream up where the console is', () => {
    const source = new TimerSource(), d = new Decoder(), h = source.heats[2];
    source.seek((h.start + LINEUP + 100) * TICK - 40);
    const s = run(source, d, h.start + LINEUP + 110);
    assert.equal(s.event, h.event); assert.equal(s.heat, h.heat); assert.equal(s.clock, '0:10.9'); assert.equal(s.state, 'running');
    const whole = new TimerSource().read(1000), again = new TimerSource();
    assert.deepEqual([...again.read(450), ...again.read(1000)], [...whole]);
    assert.equal(again.read(1000).length, 0);
});
test('Meet Manager answers each heat in the meet with a start list, and silence otherwise', () => {
    const mm = new MeetManager(), p = new StreamParser();
    for (const e of MEET) e.heats.forEach((entries, h) => {
        const [r] = p.feed(mm.record(e.event, h + 1));
        assert.equal(r.event, e.event); assert.equal(r.heat, h + 1); assert.equal(r.title, e.title); assert.equal(r.gender, e.gender);
        assert.equal(r.round, 'Timed Finals'); assert.equal(r.code, '0120');
        r.lanes.forEach((lane, i) => {
            assert.equal(lane.name, entries[i] ? entries[i][0].slice(0, 20).trim() : ''); assert.equal(lane.team, entries[i] ? entries[i][1] : '');
        });
    });
    assert.equal(p.discarded, 0);
    assert.equal(mm.record(1, 3), null); assert.equal(mm.record(99, 1), null);
    assert.equal(new StreamParser().feed(mm.record(1, 1))[0].counter, String(mm.requests % 10));
});
test('requests written to the port are answered across chunk boundaries; noise is ignored', () => {
    const mm = new MeetManager(), ask = request(2, 2);
    assert.equal(mm.write(ask.subarray(0, 3)).length, 0);
    const replies = mm.write([...ask.subarray(3), 0x55, ...request(2, 3), ...request(3, 1)]);   // heat 2/3 does not exist
    assert.deepEqual(replies.flatMap(r => new StreamParser().feed(r)).map(r => [r.event, r.heat]), [[2, 2], [3, 1]]);
    assert.equal(mm.requests, 3);
    assert.equal(mm.write([2, 0x41, 0x42, 2, ...request(1, 1).subarray(1)]).length, 1);
});
test('the scoreboard computer\'s walk and the timer stream together give names on the right lanes', () => {
    const mm = new MeetManager(), p = new StreamParser(), store = new RosterStore();
    let silent = 0;
    for (let i = 0; i < mm.walk.length; i++) { const reply = mm.walkNext(); if (reply) p.feed(reply).forEach(r => store.add(r)); else silent++; }
    assert.equal(silent, MEET.length); assert.equal(store.heats, MEET.reduce((n, e) => n + e.heats.length, 0));
    const source = new TimerSource(), d = new Decoder(), h = source.heats[1];
    const sw = payload(run(source, d, h.start + h.ticks), store.view(), { placedTimesAreFinal: true }).swimming;
    assert.equal(sw.EventNumber, 1); assert.equal(sw.HeatNumber, 2); assert.equal(sw.EventName, 'Girls 11-12 50 Free');
    assert.equal(sw.LaneAthleteTeam[0].AthleteName, 'Ivy Pemberton'); assert.equal(sw.LaneAthleteTeam[0].Team, 'OTTR');
    assert.equal(sw.LaneAthleteTeam[2].AthleteName, 'J Featherstonehaugh');                       // cut to 20 characters on the wire
    assert.equal(sw.LaneAthleteTeam[0].FinalTime, shown(h.lanes[0].final)); assert.equal(sw.LaneAthleteTeam[0].Place, String(h.lanes[0].place));
    assert.equal(sw.LaneAthleteTeam[8].LaneNumber, ' ');
});
console.log(`${count} serial simulator test groups passed`);
