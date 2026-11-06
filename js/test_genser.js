'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { RECORD_LENGTH, parseRecord, StreamParser, parseLog, readCapture, request, displayName, RosterStore } = require('./bridge/genser');
const { Decoder, parseSCB, payload } = require('./cts6/decoder');
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
// Build a record the way Meet Manager lays it out. See docs/GENSER-Serial-Protocol-Findings.md.
function record({ event, heat, title = 'Girls 9-10 50 Back', round = 'Timed Finals', gender = 'G', lanes = {}, counter = 0 }) {
    const s = Array(RECORD_LENGTH).fill(' ');
    const put = (at, value) => { for (let i = 0; i < value.length; i++) s[at + i] = value[i]; };
    s[0] = '\r'; put(1, String(counter % 10)); put(2, '0120'); put(8, title.slice(0, 28)); put(38, round); put(68, gender); put(70, title.slice(0, 28));
    for (const [lane, [name, team]] of Object.entries(lanes)) {
        const at = 116 + (lane - 1) * 38; put(at, String(lane % 10)); put(at + 1, name.slice(0, 20)); put(at + 21, team.slice(0, 4));
    }
    put(496, String(event).padStart(3)); put(499, String(heat).padStart(3));
    return Uint8Array.from(s, c => c.charCodeAt(0));
}
const join = (...parts) => Uint8Array.from(parts.flatMap(p => Array.from(p)));
const relay = record({ event: 2, heat: 1, title: 'Boys 9-10 200 Medley Relay', gender: 'B', lanes: { 3: ['Relay-B', 'TEAM'], 4: ['Relay-A', 'TEAM'], 5: ['Relay-A', 'OTH'] } });
const individual = record({ event: 88, heat: 6, counter: 7, title: 'Mixed 50 Fly', gender: 'X',
    lanes: { 1: ['Sample, Alex', 'AAA'], 2: ['Longlastname-Hyphenated, Jordan', 'BBBB'], 8: ['Example, Sam', 'CC'] } });

test('record fields, blank lanes, truncated names and right-aligned event/heat', () => {
    const r = parseRecord(relay);
    assert.equal(r.event, 2); assert.equal(r.heat, 1); assert.equal(r.title, 'Boys 9-10 200 Medley Relay');
    assert.equal(r.round, 'Timed Finals'); assert.equal(r.gender, 'B'); assert.equal(r.code, '0120'); assert.equal(r.lanes.length, 10);
    assert.deepEqual(r.lanes[2], { lane: 3, name: 'Relay-B', team: 'TEAM', extra: '' });
    assert.equal(r.lanes[0].name, ''); assert.equal(r.lanes[9].name, '');
    const i = parseRecord(individual);
    assert.equal(i.event, 88); assert.equal(i.heat, 6); assert.equal(i.counter, '7');
    assert.equal(i.lanes[1].name, 'Longlastname-Hyphena'); assert.equal(i.lanes[1].team, 'BBBB'); assert.equal(i.lanes[7].team, 'CC');
});
test('records that do not fit the layout are rejected', () => {
    const bad = (mutate) => { const b = Uint8Array.from(relay); mutate(b); return parseRecord(b); };
    assert.equal(bad(b => { b[0] = 0x20; }), null);                       // no leading CR
    assert.equal(bad(b => { b[498] = 0x41; }), null);                     // event is not a number
    assert.equal(bad(b => { b[501] = 0x20; }), null);                     // heat missing
    assert.equal(bad(b => { b[116 + 2 * 38] = 0x37; }), null);            // lane 3 slot marked 7
    assert.equal(bad(b => { b[200] = 0x0d; }), null);                     // another record starts inside
    assert.equal(parseRecord(relay.subarray(0, 501)), null);
});
test('stream parser finds records at every chunk boundary and byte at a time', () => {
    const stream = join([0x41, 0x42], relay, individual, [0x0d, 0x31]);
    const whole = new StreamParser(), expected = whole.feed(stream);
    assert.equal(expected.length, 2); assert.equal(whole.discarded, 2); assert.equal(whole.buffer.length, 2);
    for (let split = 0; split <= stream.length; split += 7) {
        const p = new StreamParser();
        assert.deepEqual([...p.feed(stream.subarray(0, split)), ...p.feed(stream.subarray(split))], expected);
    }
    const p = new StreamParser(), got = [];
    for (const b of stream) got.push(...p.feed(Uint8Array.of(b)));
    assert.deepEqual(got, expected); assert.equal(p.records, 2); assert.equal(p.bytes, stream.length);
});
test('resynchronises after a stray CR, a cut-off record, and requests on the line', () => {
    const p = new StreamParser({ staleMs: 3000 });
    assert.equal(p.feed(join([0x0d, 0x58, 0x59], relay), 0).length, 1);           // stray CR, then a real record
    assert.equal(p.discarded, 3);
    assert.equal(p.feed(individual.subarray(0, 300), 1000).length, 0);            // record cut off mid-way
    assert.deepEqual(p.feed(relay, 9000).map(r => r.event), [2]);                 // long pause: partial dropped
    assert.equal(p.discarded, 303);
    const q = new StreamParser();
    assert.deepEqual(q.feed(join(request(2, 1), individual, request(2, 2))).map(r => r.event), [88]);
    assert.equal(q.requests, 2); assert.equal(q.discarded, 0);
    const split = new StreamParser(); split.feed(request(12, 3).subarray(0, 5)); split.feed(request(12, 3).subarray(5));
    assert.equal(split.requests, 1);
});
test('request framing matches the scoreboard computer: STX EEE HH T EOT', () => {
    assert.deepEqual(Array.from(request(1, 1)), [0x02, 0x30, 0x30, 0x31, 0x30, 0x31, 0x31, 0x04]);
    assert.deepEqual(Array.from(request(88, 6)), [0x02, 0x30, 0x38, 0x38, 0x30, 0x36, 0x31, 0x04]);
    assert.throws(() => request(0, 1), /Event/); assert.throws(() => request(1000, 1), /Event/); assert.throws(() => request(1, 100), /Heat/);
});
test('names: Last, First becomes First Last; relay names are untouched', () => {
    assert.equal(displayName('Sample, Alex'), 'Alex Sample'); assert.equal(displayName('Van Example, Mary Jo'), 'Mary Jo Van Example');
    assert.equal(displayName('Relay-B'), 'Relay-B'); assert.equal(displayName('Sample, Alex', false), 'Sample, Alex');
    assert.equal(displayName('Truncated,'), 'Truncated,');
});
// CTS scoreboard blocks, as in test_cts6.js
const control = channel => 128 | ((channel ^ 31) << 1);
const block = (channel, chars) => [control(channel), ...Array.from(chars, (ch, i) => (i << 4) | (ch === ' ' ? 0 : 15 - Number(ch)))];
test('start lists feed the overlay JSON by event, heat and lane', () => {
    const store = new RosterStore();
    store.add(parseRecord(relay)); store.add(parseRecord(individual));
    assert.equal(store.heats, 2); assert.equal(store.has(2, 1), true); assert.equal(store.has(2, 2), false); assert.equal(store.has(88, 6), true);
    const d = new Decoder(); d.feed([...block(12, '  2    1'), ...block(0, '    123 '), control(20)]); d.finish();
    const sw = payload(d.snapshot(), store.view()).swimming;
    assert.equal(sw.EventNumber, 2); assert.equal(sw.HeatNumber, 1); assert.equal(sw.EventName, 'Boys 9-10 200 Medley Relay');
    assert.equal(sw.RunningTime, '0:12.3'); assert.equal(sw.LaneAthleteTeam.length, 10);
    assert.equal(sw.LaneAthleteTeam[2].AthleteName, 'Relay-B'); assert.equal(sw.LaneAthleteTeam[2].Team, 'TEAM'); assert.equal(sw.LaneAthleteTeam[2].LaneNumber, '3');
    assert.equal(sw.LaneAthleteTeam[0].AthleteName, ''); assert.equal(sw.LaneAthleteTeam[0].LaneNumber, ' ');
    const d2 = new Decoder(); d2.feed([...block(12, ' 88    6'), control(20)]); d2.finish();
    assert.equal(payload(d2.snapshot(), store.view()).swimming.LaneAthleteTeam[0].AthleteName, 'Alex Sample');
    assert.equal(payload(d2.snapshot(), store.view({ firstLast: false })).swimming.LaneAthleteTeam[0].AthleteName, 'Sample, Alex');
    const d3 = new Decoder(); d3.feed([...block(12, ' 88    5'), control(20)]); d3.finish();       // heat we never received
    assert.equal(payload(d3.snapshot(), store.view()).swimming.LaneAthleteTeam[0].AthleteName, '');
});
test('a newer start list replaces the old one; storage round trip keeps heats in place', () => {
    const store = new RosterStore();
    store.add(parseRecord(individual));
    store.add(parseRecord(record({ event: 88, heat: 6, title: 'Mixed 50 Fly', lanes: { 1: ['Replacement, Pat', 'ZZ'] } })));
    assert.equal(store.heats, 1); assert.equal(store.view().get(88).heats[5][0].name, 'Pat Replacement'); assert.equal(store.view().get(88).heats[5][7].name, '');
    const copy = RosterStore.fromJSON(JSON.parse(JSON.stringify(store)));
    assert.equal(copy.heats, 1); assert.equal(copy.has(88, 6), true); assert.equal(copy.has(88, 1), false);
    assert.equal(copy.view().get(88).title, 'Mixed 50 Fly');
    assert.equal(RosterStore.fromJSON('nonsense').heats, 0); assert.equal(RosterStore.fromJSON([{ event: 'x' }, null]).heats, 0);
    store.clear(); assert.equal(store.heats, 0); assert.equal(store.view().size, 0);
});
// A capture as com-monitor writes it: 16 bytes a line, a route column 24 wide, the text between bars.
function logText(frames) {
    const lines = ['# com-monitor log started 2026-01-01 10:00:00.000', '2026-01-01 10:00:00.010 # PORTB: open 9600 8N1 none'];
    for (const [ms, from, to, bytes] of frames) {
        const stamp = `2026-01-01 10:00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
        for (let i = 0; i < bytes.length; i += 16) {
            const row = Array.from(bytes.slice(i, i + 16));
            const hex = row.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(47);
            const shown = row.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·').join('');
            lines.push(`${i ? ' '.repeat(48) : stamp + ' ' + (from + ' ▶' + (to ? ' ' + to : '')).padEnd(24)}  ${hex}  |${shown}|`);
        }
    }
    return lines.join('\r\n') + '\r\n# com-monitor log closed 2026-01-01 10:05:00.000\r\n';
}
test('a com-monitor log gives back each frame\'s bytes, sender and time', () => {
    const awkward = record({ event: 5, heat: 2, lanes: { 1: ['AB CD | EF 01, 0D', 'A|B'] } });     // text that looks like hex, and bars
    const chunks = parseLog(logText([[1000, 'PORTA', 'PORTB', request(5, 2)], [1040, 'PORTB', 'PORTA', awkward], [2500, 'PORTC', '', [0x32]]]));
    assert.deepEqual(chunks.map(c => [c.source, c.bytes.length]), [['PORTA', 8], ['PORTB', 502], ['PORTC', 1]]);
    assert.deepEqual(Array.from(chunks[0].bytes), Array.from(request(5, 2))); assert.deepEqual(Array.from(chunks[1].bytes), Array.from(awkward));
    assert.equal(chunks[1].at - chunks[0].at, 40); assert.equal(chunks[2].at - chunks[0].at, 1500);
    assert.equal(parseLog('Smith, Alex --TEAM\n# just notes\n   0D 30 30\n').length, 0);      // no frame line, so nothing to continue
});
test('start lists are read from a capture log, or from the bytes themselves', () => {
    // The scoreboard computer's next request is logged while Meet Manager is still sending its reply.
    const log = logText([[0, 'PORTA', 'PORTB', request(2, 1)], [30, 'PORTB', 'PORTA', relay.subarray(0, 200)], [110, 'PORTA', 'PORTB', request(2, 2)],
        [150, 'PORTB', 'PORTA', relay.subarray(200)], [900, 'PORTA', 'PORTB', request(88, 6)], [930, 'PORTB', 'PORTA', individual]]);
    assert.deepEqual(readCapture(log).map(r => [r.event, r.heat]), [[2, 1], [88, 6]]);
    assert.deepEqual(readCapture(log, { source: 'PORTB' }).map(r => r.event), [2, 88]); assert.equal(readCapture(log, { source: 'PORTA' }).length, 0);
    assert.deepEqual(readCapture(join(request(2, 1), relay, [0x55], individual)).map(r => r.event), [2, 88]);
    assert.equal(readCapture('not a capture').length, 0); assert.equal(readCapture(Uint8Array.of(1, 2, 3)).length, 0);
});
test('an .scb file replaces its whole event; a later start list replaces one heat of it', () => {
    const slots = entries => Array.from({ length: 10 }, (_, i) => entries[i + 1] || ' -- ');
    const scb = (event, title, ...heats) => [`#${event} ${title}`, ...heats.flatMap(slots)].join('\r\n') + '\r\n';
    const store = new RosterStore();
    store.add(parseRecord(individual));                                                          // event 88 heat 6, from serial
    store.addEvent(parseSCB(scb(88, 'MIXED 50 FLY', { 4: 'Sample, Alex     --AAA' }, { 5: 'Example, Sam     --CC' })));
    assert.equal(store.heats, 2); assert.equal(store.has(88, 6), false); assert.equal(store.has(88, 2), true);
    store.addEvent(parseSCB(scb(3, 'BOYS 200 MEDLEY RELAY', { 3: 'TEAM B --TEAM' })));
    assert.equal(store.heats, 3); assert.equal(store.events.size, 2);
    assert.deepEqual(store.view().get(88).heats[0][3], { name: 'Alex Sample', team: 'AAA' });
    assert.equal(store.view({ firstLast: false }).get(88).heats[1][4].name, 'Example, Sam'); assert.equal(store.view().get(3).heats[0][2].name, 'TEAM B');
    store.add(parseRecord(record({ event: 88, heat: 2, title: 'Mixed 50 Fly', lanes: { 5: ['Replacement, Pat', 'ZZ'] } })));
    assert.equal(store.heats, 3); assert.equal(store.view().get(88).heats[1][4].name, 'Pat Replacement'); assert.equal(store.view().get(88).title, 'Mixed 50 Fly');
    const copy = RosterStore.fromJSON(JSON.parse(JSON.stringify(store)));
    assert.equal(copy.heats, 3); assert.equal(copy.view().get(88).heats[0][3].team, 'AAA');
    const d = new Decoder(); d.feed([...block(12, ' 88    1'), control(20)]); d.finish();
    assert.equal(payload(d.snapshot(), store.view()).swimming.LaneAthleteTeam[3].AthleteName, 'Alex Sample');
});
// Optional: decode a com-monitor log of the real link. Keep captures with athlete names outside the repo.
//   node js/test_genser.js /path/to/capture.log [PORT_NAME]
if (process.argv[2]) test('capture regression: every start list in a com-monitor log decodes', () => {
    const records = readCapture(fs.readFileSync(process.argv[2], 'utf8'), { source: process.argv[3] || '' }), store = new RosterStore();
    assert(records.length > 0, 'no start lists found; check the port name');
    for (const r of records) store.add(r);
    const entries = records.reduce((n, r) => n + r.lanes.filter(l => l.name).length, 0);
    console.log(`  ${records.length} start lists, ${store.heats} distinct heats in ${store.events.size} events, ${entries} lane entries`);
});
console.log(`${count} GENSER test groups passed`);
