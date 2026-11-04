'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Decoder, Replay, parseSCB, parseCapture, payload } = require('./cts6/decoder');
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
const control = (channel, format = false, universal = false) => 128 | ((channel ^ 31) << 1) | Number(format) | (universal ? 64 : 0);
const block = (channel, chars, format = false, universal = false) => [control(channel, format, universal), ...Array.from(chars, (ch, i) => (i << 4) | (ch === ' ' ? 0 : 15 - Number(ch)))];
const sample = [0x4d, 0x5d, ...block(12, ' 73    1'), ...block(0, '    130 '), ...block(4, '41  2872'), ...block(5, '5       ', false, true), control(20)];
function decode(bytes) { const d = new Decoder(); d.feed(bytes); d.finish(); return d; }
test('legacy channels, complemented digits, clock, lane time and place', () => {
    const s = decode(sample).snapshot();
    assert.equal(s.event, 73); assert.equal(s.heat, 1); assert.equal(s.clock, '0:13.0');
    assert.equal(s.lanes[3].place, '1'); assert.equal(s.lanes[3].time, '0:28.72');
    assert.equal(s.lanes[4].followsClock, true); assert.equal(s.lanes[4].time, ''); assert.equal(s.orphans, 2);
});
test('all chunk boundaries preserve parser state; no partial block commits', () => {
    for (let split = 0; split <= sample.length; split++) {
        const d = new Decoder(); d.feed(sample.slice(0, split)); d.feed(sample.slice(split)); d.finish();
        assert.deepEqual(d.snapshot(), decode(sample).snapshot());
    }
    const d = new Decoder(); for (const b of sample) d.feed([b]); d.finish(); assert.deepEqual(d.snapshot(), decode(sample).snapshot());
    const partial = new Decoder(); partial.feed(block(12, ' 73    1'));
    assert.equal(partial.snapshot().event, null); partial.feed([control(0)]); assert.equal(partial.snapshot().event, 73);
});
test('format data never overwrites digits; universal lane clears old fixed time', () => {
    const d = decode(sample); d.feed(block(4, '22222222', true)); d.finish();
    assert.equal(d.snapshot().lanes[3].time, '0:28.72');
    d.feed([control(4, false, true), 0x0b, 0x10]); d.finish(); assert.equal(d.snapshot().lanes[3].time, '');
});
test('new event/heat hides old lane results until fresh readout', () => {
    const d = decode(sample); d.feed(block(12, ' 75    1')); d.finish();
    assert.equal(d.snapshot().lanes[3].time, ''); assert.equal(d.snapshot().lanes[3].place, '');
});
test('clock advancement, exact seconds and stale/zero fail closed', () => {
    const d = new Decoder();
    d.feed(block(0, '    000 '), 0); d.finish(0); assert.equal(d.snapshot().state, 'unknown');
    d.feed(block(0, '    001 '), 100); d.finish(100); assert.equal(d.snapshot(100).state, 'running');
    d.feed(block(0, '    100 '), 1000); d.finish(1000); assert.equal(d.snapshot(1000).clock, '0:10.0');
    assert.equal(d.snapshot(3000).state, 'unknown');
    d.feed(block(0, '     00 '), 3100); d.finish(3100); assert.equal(d.snapshot(3100).state, 'unknown');
    d.feed([control(1, true), 0x0d], 3150); d.finish(3150); assert.equal(d.snapshot(3150).state, 'reset');
    assert.equal(payload(d.snapshot(3150), new Map()).swimming.ScoreboardCurrentState, null);
    assert.equal(payload(d.snapshot(3150), new Map(), { trustReset: true }).swimming.ScoreboardCurrentState, 2);
    d.feed(block(0, '     01 '), 3200); d.finish(3200); assert.equal(d.snapshot(3200).state, 'running');
});
const scb = '#73 MIXED 100 FREE RELAY\r\n' + Array.from({ length: 20 }, (_, i) => (i === 3 ? 'TEST RELAY A --TEST' : i === 10 ? 'SECOND HEAT --TEAM' : ' -- ')).join('\r\n') + '\r\n';
test('SCB blank lanes and multiple heats preserved, malformed slots rejected', () => {
    const r = parseSCB(scb); assert.equal(r.event, 73); assert.equal(r.heats.length, 2);
    assert.equal(r.heats[0][0].name, ''); assert.equal(r.heats[0][3].name, 'TEST RELAY A'); assert.equal(r.heats[1][0].team, 'TEAM');
    assert.throws(() => parseSCB('#1 test\nA -- B\n'), /groups of 10/);
});
test('adapter matches event/heat/lane without stale names or unverified finishes', () => {
    const r = parseSCB(scb), rosters = new Map([[73, r]]), s = decode(sample).snapshot();
    const sw = payload(s, rosters).swimming;
    assert.equal(sw.LaneAthleteTeam.length, 10); assert.equal(sw.LaneAthleteTeam[3].AthleteName, 'TEST RELAY A');
    assert.equal(sw.LaneAthleteTeam[3].FinalTime, ''); assert.equal(sw.LaneAthleteTeam[3].SplitTime, '0:28.72');
    assert.equal(sw.LaneAthleteTeam[3].Place, ' ');
    assert.equal(payload(s, rosters, { placedTimesAreFinal: true }).swimming.LaneAthleteTeam[3].FinalTime, '0:28.72');
    s.event = 74; assert.equal(payload(s, rosters).swimming.LaneAthleteTeam[3].AthleteName, '');
    s.event = 73; s.heat = 2; assert.equal(payload(s, rosters).swimming.LaneAthleteTeam[0].AthleteName, 'SECOND HEAT');
});
const header = '\ufeff#,Time,Dir,Hex Data,ASCII,Bytes,Delta (ms)\r\n';
const csv = header + '1,23:59:59.900,RX ←,"BE 70 6F 5F 40 30 20","comma, quote ""ok""",7,\r\n' +
    '2,23:59:59.950,TX →,00,,1,50\r\n3,00:00:00.100,RX ←,A6 00 18 2C 30 40 50 60 7E,,9,150\r\n';
test('CSV BOM, quotes, RX filtering, byte validation and midnight rollover', () => {
    const c = parseCapture(csv); assert.equal(c.length, 2); assert.equal(c[1].at, 200); assert.equal(c[0].bytes.length, 7);
    assert.throws(() => parseCapture(csv.replace('7,\r\n', '8,\r\n')), /Byte count/);
    assert.throws(() => parseCapture(csv.replace('BE 70', 'BE GG')), /Invalid hex/);
    assert.throws(() => parseCapture(header + '1,08:00:00.000,RX,BE,,1,\n2,07:59:59.000,RX,BE,,1,'), /backwards/);
});
test('replay seek is deterministic including rewind and final block flush', () => {
    const chunks = [{ at: 0, bytes: Uint8Array.from(sample.slice(0, 10)) }, { at: 100, bytes: Uint8Array.from(sample.slice(10)) }];
    const r = new Replay(chunks), end = r.seek(100); r.seek(0); assert.deepEqual(r.seek(100), end);
    const uninterrupted = new Decoder(); for (const c of chunks) uninterrupted.feed(c.bytes, c.at); uninterrupted.finish(100);
    assert.deepEqual(end, uninterrupted.snapshot(100));
});
// Optional real-world validation. Keep meet captures/athlete data outside the repo.
if (process.argv[2]) test('weekend capture and SCB archive regression', () => {
    const dir = process.argv[2], chunks = parseCapture(fs.readFileSync(path.join(dir, 'CTS6_Capture.csv'), 'utf8'));
    assert.equal(chunks.length, 1823); assert.equal(chunks.at(-1).at, 637477);
    assert.equal(chunks.reduce((n, c) => n + c.bytes.length, 0), 556385);
    const d = new Decoder(), events = [], states = new Set();
    for (const c of chunks) {
        d.feed(c.bytes, c.at); const s = d.snapshot(c.at); states.add(s.state);
        if (s.event && events.at(-1) !== s.event) events.push(s.event);
    }
    d.finish(chunks.at(-1).at); const s = d.snapshot(chunks.at(-1).at);
    assert.deepEqual(events, [73, 74, 75, 76, 77, 78, 79]);
    assert.equal(s.heat, 1); assert.equal(s.clock, '2:12.8'); assert.equal(s.lanes[3].time, '1:44.38');
    assert(states.has('running')); assert(states.has('reset'));
    const rosters = new Map(); for (const f of fs.readdirSync(dir).filter(n => /\.scb$/i.test(n))) {
        const r = parseSCB(new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(dir, f)))); rosters.set(r.event, r);
    }
    assert.equal(rosters.size, 75); assert.equal(rosters.get(79).heats.length, 2);
    assert.equal(payload(s, rosters).swimming.EventName, 'MIXED 13&O 200 FREE RELAY');
    console.log('  Events ' + events.join(', ') + '; ' + chunks.length + ' chunks; all 75 SCB files parsed.');
});
console.log(`${count} CTS6 test groups passed`);
