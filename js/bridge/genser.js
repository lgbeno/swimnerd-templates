/* HY-TEK Meet Manager "generic scoreboard" (GENSER) serial link.
 * Record layout reconstructed from a capture of Meet Manager answering a scoreboard
 * computer; see docs/GENSER-Serial-Protocol-Findings.md. Not a vendor specification.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GENSER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const RECORD_LENGTH = 502, LANE_SLOTS = 10, SLOT_LENGTH = 38, FIRST_SLOT = 116;
    const STX = 0x02, EOT = 0x04, CR = 0x0d, EMPTY = new Uint8Array(0);
    // Windows-1252, matching the SCB importer. Each byte maps to one UTF-16 unit,
    // so string offsets equal byte offsets.
    const windows1252 = typeof TextDecoder === 'function' ? new TextDecoder('windows-1252') : null;
    const text = bytes => windows1252 ? windows1252.decode(bytes) : String.fromCharCode.apply(null, bytes);
    const digits = c => c >= 0x30 && c <= 0x39;

    /** Decode one 502-byte start-list record, or return null if it is not one. */
    function parseRecord(bytes) {
        if (bytes.length !== RECORD_LENGTH || bytes[0] !== CR) return null;
        for (let i = 1; i < RECORD_LENGTH; i++) if (bytes[i] < 0x20 || bytes[i] === 0x7f) return null;
        const s = text(bytes);
        const event = s.slice(496, 499).trim(), heat = s.slice(499, 502).trim();
        if (!/^\d{1,3}$/.test(event) || !/^\d{1,3}$/.test(heat) || +event < 1 || +heat < 1) return null;
        const lanes = [];
        for (let k = 0; k < LANE_SLOTS; k++) {
            const slot = s.substr(FIRST_SLOT + k * SLOT_LENGTH, SLOT_LENGTH), mark = slot[0];
            // Slots 1-9 carry their own lane digit. How lane 10 is marked has not been observed.
            if (mark !== ' ' && k < 9 && mark !== String(k + 1)) return null;
            lanes.push({ lane: k + 1, name: slot.slice(1, 21).trim(), team: slot.slice(21, 25).trim(), extra: slot.slice(25).trim() });
        }
        return { counter: s[1], code: s.slice(2, 6), event: +event, heat: +heat, title: s.slice(8, 36).trim(),
            round: s.slice(38, 68).trim(), gender: s[68].trim(), shortTitle: s.slice(70, 98).trim(), lanes };
    }

    /** Find records in a byte stream. Records have no terminator: each begins with CR and is 502 bytes. */
    class StreamParser {
        constructor({ staleMs = 3000 } = {}) { this.staleMs = staleMs; this.reset(); }
        reset() { this.buffer = EMPTY; this.lastAt = null; this.bytes = 0; this.records = 0; this.requests = 0; this.discarded = 0; }
        feed(chunk, at = 0) {
            const out = [];
            this.bytes += chunk.length;
            // A record is sent in one burst. A long pause inside one means it was cut off.
            if (this.buffer.length && this.lastAt !== null && at - this.lastAt > this.staleMs) { this.discarded += this.buffer.length; this.buffer = EMPTY; }
            this.lastAt = at;
            const data = new Uint8Array(this.buffer.length + chunk.length);
            data.set(this.buffer); data.set(chunk, this.buffer.length);
            let i = 0;
            while (i < data.length) {
                if (data[i] === STX) {
                    // The scoreboard computer's side of the conversation: STX EEE HH T EOT.
                    if (data.length - i < 8) break;
                    if (data[i + 7] === EOT && [1, 2, 3, 4, 5, 6].every(n => digits(data[i + n]))) { this.requests++; i += 8; continue; }
                }
                if (data[i] !== CR) { i++; this.discarded++; continue; }
                if (data.length - i < RECORD_LENGTH) break;
                const record = parseRecord(data.subarray(i, i + RECORD_LENGTH));
                if (record) { out.push(record); this.records++; i += RECORD_LENGTH; }
                else { i++; this.discarded++; }
            }
            this.buffer = data.slice(i);
            return out;
        }
    }

    /** Bytes in a com-monitor capture log, in order, with the port that sent them: [{ at, source, bytes }].
     *  A frame starts on a "date time PORT ▶ [PORT]  hex  |text|" line; indented lines continue it. */
    function parseLog(text) {
        const head = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) (\S+) ▶(?: \S+)? {2,}(\S.*)$/;
        const chunks = []; let current = null;
        for (const line of text.split(/\r?\n/)) {
            const m = head.exec(line), more = !m && current && /^\s+(\S.*)$/.exec(line);
            const hex = m || more ? (m ? m[9] : more[1]).split('|')[0].trim() : '';
            if (!/^[\da-f]{2}( [\da-f]{2})*$/i.test(hex)) { current = null; continue; }
            if (m) { current = { at: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]), source: m[8], bytes: [] }; chunks.push(current); }
            for (const byte of hex.split(' ')) current.bytes.push(parseInt(byte, 16));
        }
        for (const chunk of chunks) chunk.bytes = Uint8Array.from(chunk.bytes);
        return chunks;
    }

    /** Every start list in a capture, oldest first: a com-monitor log (string) or the link's raw bytes. */
    function readCapture(input, { source = '' } = {}) {
        const chunks = typeof input === 'string' ? parseLog(input) : [{ at: 0, source: '', bytes: input }];
        // One parser per sending port: a request on the other line can land in the middle of a record.
        const parsers = new Map(), records = [];
        for (const chunk of chunks) {
            if (source && chunk.source !== source) continue;
            let parser = parsers.get(chunk.source);
            if (!parser) parsers.set(chunk.source, parser = new StreamParser());
            for (const record of parser.feed(chunk.bytes, chunk.at)) records.push(record);
        }
        return records;
    }

    /** Request one heat's start list, as the scoreboard computer does: STX EEE HH T EOT. */
    function request(event, heat, type = 1) {
        if (!Number.isInteger(event) || event < 1 || event > 999) throw new RangeError('Event must be 1-999');
        if (!Number.isInteger(heat) || heat < 1 || heat > 99) throw new RangeError('Heat must be 1-99');
        if (!Number.isInteger(type) || type < 0 || type > 9) throw new RangeError('Request type must be one digit');
        const body = String(event).padStart(3, '0') + String(heat).padStart(2, '0') + type;
        return Uint8Array.from([STX, ...Array.from(body, c => c.charCodeAt(0)), EOT]);
    }

    /** "Last, First" as sent by Meet Manager, shown as "First Last". Relay names are left alone. */
    function displayName(name, firstLast = true) {
        const m = firstLast && /^([^,]+),\s*(\S.*)$/.exec(name);
        return m ? m[2].trim() + ' ' + m[1].trim() : name;
    }

    /** Start lists by event and heat, in the shape CTS6.payload() expects for its roster map. */
    class RosterStore {
        constructor() { this.clear(); }
        clear() { this.events = new Map(); this.heats = 0; this.version = (this.version || 0) + 1; this._view = null; }
        add(record) {
            let entry = this.events.get(record.event);
            if (!entry) { entry = { event: record.event, title: '', heats: [] }; this.events.set(record.event, entry); }
            if (record.title) entry.title = record.title;
            if (!entry.heats[record.heat - 1]) this.heats++;
            entry.heats[record.heat - 1] = record.lanes.map(l => ({ name: l.name, team: l.team }));
            this.version++; this._view = null;
        }
        /** Replace one event with every heat of a Meet Manager .scb start-list file, as CTS6.parseSCB() reads it. */
        addEvent({ event, title, heats }) {
            this.heats -= (this.events.get(event)?.heats || []).filter(Boolean).length;
            const entry = { event, title: title || '', heats: heats.map(h => h.map(a => ({ name: a.name, team: a.team }))) };
            this.events.set(event, entry); this.heats += entry.heats.length;
            this.version++; this._view = null;
        }
        has(event, heat) { return !!this.events.get(event)?.heats[heat - 1]; }
        view({ firstLast = true } = {}) {
            if (this._view && this._view.firstLast === firstLast) return this._view.map;
            const map = new Map();
            for (const [event, entry] of this.events) map.set(event, { event, title: entry.title,
                heats: entry.heats.map(h => h && h.map(a => ({ name: displayName(a.name, firstLast), team: a.team }))) });
            this._view = { firstLast, map };
            return map;
        }
        toJSON() { return Array.from(this.events.values(), e => ({ event: e.event, title: e.title, heats: Array.from(e.heats, h => h || null) })); }
        static fromJSON(data) {
            const store = new RosterStore();
            for (const e of Array.isArray(data) ? data : []) {
                if (!Number.isInteger(e?.event) || !Array.isArray(e.heats)) continue;
                const entry = { event: e.event, title: String(e.title || ''), heats: [] };
                e.heats.forEach((h, i) => {
                    if (!Array.isArray(h)) return;
                    entry.heats[i] = h.map(a => ({ name: String(a?.name || ''), team: String(a?.team || '') })); store.heats++;
                });
                store.events.set(e.event, entry);
            }
            return store;
        }
    }
    return { RECORD_LENGTH, parseRecord, StreamParser, parseLog, readCapture, request, displayName, RosterStore };
});
