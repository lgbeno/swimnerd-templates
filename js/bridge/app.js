/* Serial bridge controller: timer stream and event data in, one overlay feed out.
 *
 *   timer stream      -> CTS6.Decoder        (clock, lanes, event/heat), from either
 *     timer port        -> live bytes
 *     a capture file    -> the same bytes, replayed at the pace they were recorded
 *   event data        -> GENSER.RosterStore  (titles, names, teams), from either
 *     Meet Manager port -> GENSER.StreamParser
 *     files             -> CTS6.parseSCB() or GENSER.readCapture()
 *   both              -> CTS6.payload()      -> BroadcastChannel, relay, OBS
 */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    // Simulated start lists are stored apart, so made-up names never turn up at a real meet.
    const SETTINGS = 'swimnerd-bridge-settings', ROSTERS = 'swimnerd-bridge-rosters' + (globalThis.SerialSim?.active ? '-simulated' : '');
    const channel = new BroadcastChannel('swimnerd-scoreboard');
    const parser = new GENSER.StreamParser();
    let decoder = new CTS6.Decoder(), latest = decoder.snapshot(0), timerStart = performance.now();
    let rosters = new GENSER.RosterStore(), lastRecord = null, lastRecordAt = null, saveTimer = null;
    let lastSent = '', lastSendAt = 0, sent = 0;
    const clock = { value: null, at: null, steps: [], skipped: 0 };
    const asked = new Map(); let askedFor = '', lastAskAt = -Infinity;
    const changes = [];     // what arriving event data did, newest first: { at, source, text, kind }
    let changeCount = 0, unchanged = 0, viewKey = '', optionsKey = '';
    let replay = null;      // a loaded timer capture: { name, pacer, duration, at, playing, lastTick, note }

    const showError = e => { $('error').hidden = false; $('error').textContent = e.message || String(e); };
    const hideError = () => { $('error').hidden = true; };

    /** One Web Serial port with a read loop that survives recoverable line errors. */
    class SerialLink {
        constructor(onChunk, onOpen, onClose) {
            this.onChunk = onChunk; this.onOpen = onOpen; this.onClose = onClose;
            this.port = null; this.reader = null; this.opening = false; this.closing = false; this.readErrors = 0;
        }
        get connected() { return !!this.port; }
        async connect(options, other) {
            if (this.port || this.opening) return;
            this.opening = true; hideError(); render();
            try {
                const selected = await navigator.serial.requestPort();
                if (other && selected === other.port) throw new Error('That port is already connected as the other stream. Choose a different port.');
                await selected.open(options);
                this.port = selected; this.opening = false; this.closing = false; this.readErrors = 0;
                this.onOpen(); render();
                let recent = [];
                while (selected.readable && !this.closing) {
                    this.reader = selected.readable.getReader();
                    try {
                        for (;;) {
                            const { value, done } = await this.reader.read();
                            if (done) break;
                            if (value && value.length) this.onChunk(value);
                        }
                        break;
                    } catch (e) {
                        // Framing, parity, overrun and break errors are recoverable: the port
                        // offers a fresh stream. A lost device or a flood of errors is not.
                        this.readErrors++;
                        const now = performance.now(); recent = recent.filter(t => now - t < 2000); recent.push(now);
                        if (e.name === 'NetworkError') throw e;
                        if (recent.length > 20) throw new Error('Too many serial errors (' + (e.message || e.name) + '). Check the baud rate and parity.');
                    } finally {
                        try { this.reader.releaseLock(); } catch (e) { /* stream already released */ }
                        this.reader = null;
                    }
                }
            } catch (e) { if (e.name !== 'NotFoundError') showError(e); }
            finally {
                if (this.port) { try { await this.port.close(); } catch (e) { /* device already gone */ } }
                this.port = null; this.opening = false; this.closing = false;
                this.onClose(); render();
            }
        }
        async disconnect() {
            if (!this.port || this.closing) return;
            this.closing = true; render();
            if (this.reader) { try { await this.reader.cancel(); } catch (e) { showError(e); } }
        }
        async write(bytes) {
            const writer = this.port?.writable?.getWriter();
            if (!writer) return false;
            try { await writer.write(bytes); return true; } finally { writer.releaseLock(); }
        }
    }

    // ---- timer stream -------------------------------------------------------------------
    function trackClock(at) {
        const seconds = decoder.clockSeconds;
        if (seconds === null) { clock.value = null; clock.at = null; return; }
        if (clock.value !== null) {
            const step = Math.round((seconds - clock.value) * 10);
            if (step >= 1) {
                clock.steps.push({ at, gap: at - clock.at });
                if (step >= 2 && step <= 20) clock.skipped += step - 1;
            }
        }
        if (seconds !== clock.value) { clock.value = seconds; clock.at = at; }
        while (clock.steps.length && at - clock.steps[0].at > 10000) clock.steps.shift();
    }
    function feedTimer(chunk, at) {
        let sequence = decoder.clockSequence;
        // Publish at every completed clock block, so two ticks that arrive in one read both go out.
        for (let i = 0; i < chunk.length; i++) {
            decoder.feed(chunk.subarray(i, i + 1), at);
            if (decoder.clockSequence !== sequence) {
                sequence = decoder.clockSequence; latest = decoder.snapshot(at); trackClock(at); publish();
            }
        }
        latest = decoder.snapshot(at); publish();
    }
    function resetTimer() { decoder = new CTS6.Decoder(); latest = decoder.snapshot(0); Object.assign(clock, { value: null, at: null, steps: [], skipped: 0 }); }
    const timer = new SerialLink(chunk => feedTimer(chunk, performance.now() - timerStart),
        () => { replay = null; resetTimer(); timerStart = performance.now(); },
        () => { stopPublishing(); latest = decoder.snapshot(Infinity); });
    /** The timer stream is arriving: from the port, or from a capture that is playing. */
    const timerLive = () => timer.connected || !!replay?.playing;

    // ---- timer capture replay --------------------------------------------------------------
    const elapsed = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    /** Feed the capture up to `target` ms; `live` also publishes and tracks the clock, as the port does. */
    function replayTo(target, live) {
        for (const part of replay.pacer.take(target)) { if (live) feedTimer(part.bytes, part.at); else decoder.feed(part.bytes, part.at); }
        replay.at = target; latest = decoder.snapshot(target);
    }
    function seekReplay(target) {
        target = Math.max(0, Math.min(replay.duration, target));
        resetTimer(); replay.pacer.rewind();
        replayTo(target, false); lastSent = '';
    }
    function stepReplay() {
        if (!replay?.playing) return;
        const now = performance.now(), target = replay.at + (now - replay.lastTick) * Number($('timerSpeed').value);
        replay.lastTick = now;
        replayTo(Math.min(target, replay.duration), true);
        if (target >= replay.duration) { decoder.finish(replay.duration); replay.playing = false; latest = decoder.snapshot(replay.duration); render(); }
    }
    /** Load a capture of the timer stream: a serial monitor CSV export, or a com-monitor log. */
    async function loadTimerCapture(file) {
        hideError();
        try {
            if (file.size > 50 * 1024 * 1024) throw new Error('larger than 50 MB');
            const text = new TextDecoder().decode(await file.arrayBuffer()), frames = GENSER.parseLog(text);
            let chunks, steps;
            if (frames.length) {
                // A log can hold several ports. The timer is the one whose clock counts.
                const origin = frames[0].at, ports = new Map();
                for (const f of frames) { if (!ports.has(f.source)) ports.set(f.source, []); ports.get(f.source).push({ at: f.at - origin, bytes: f.bytes }); }
                for (const candidate of ports.values()) { const found = CTS6.clockSteps(candidate); if (!steps || found.steady > steps.steady) { chunks = candidate; steps = found; } }
            } else { chunks = CTS6.parseCapture(text); steps = CTS6.clockSteps(chunks); }
            if (steps.clocks < 10) {
                const opened = Array.from(text.matchAll(/# (\S+): open (\d+) (\d[NEO]\d)/g), m => `${m[1]} at ${m[2]} ${m[3]}`);
                throw new Error('no CTS6 clock found.' + (opened.length ? ` The log says its ports were opened as ${[...new Set(opened)].join(', ')}. The console sends 9600 8E1, and a capture recorded with other settings cannot be replayed.` : ''));
            }
            const start = chunks[0].at;
            const pacer = new CTS6.Pacer(chunks.map(c => ({ at: c.at - start, bytes: c.bytes })), Number($('timerBaud').value));
            replay = { name: file.name, pacer, duration: pacer.duration, at: 0, playing: false, lastTick: 0,
                note: steps.changes >= 20 && steps.steady < steps.changes * 0.9 ? ` The clock counts steadily in only ${Math.round(100 * steps.steady / steps.changes)}% of its steps, so this capture may have been recorded with the wrong baud or parity.` : '' };
            stopPublishing(); seekReplay(0);
        } catch (e) { showError(new Error(`Could not load a timer capture from ${file.name}: ${e.message || e}`)); }
        render();
    }

    // ---- event data: start lists from Meet Manager's serial link or from files ------------
    function saveRosters() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { localStorage.setItem(ROSTERS, JSON.stringify(rosters)); } catch (e) { /* storage full or blocked */ } }, 500);
    }
    const laneText = a => a.name ? a.name + (a.team ? ` (${a.team})` : '') : 'empty';
    /** Note what one stored heat did. Repeats that change nothing are counted, not listed. */
    function note(result, source, at) {
        if (result.status === 'unchanged') { unchanged++; return; }
        const detail = [result.title && `title “${result.title.from}” → “${result.title.to}”`,
            ...result.changes.map(c => `lane ${c.lane} ${laneText(c.from)} → ${laneText(c.to)}`)].filter(Boolean).join('; ');
        changes.unshift({ at, source, kind: result.status, text: `Event ${result.event} heat ${result.heat} ${result.status}` + (detail ? ': ' + detail : '') });
        changes.length = Math.min(changes.length, 200); changeCount++;
    }
    function onGenserChunk(chunk) {
        const now = performance.now(), records = parser.feed(chunk, now);
        for (const record of records) { note(rosters.add(record, 'serial', Date.now()), 'serial', Date.now()); lastRecord = record; lastRecordAt = now; }
        if (records.length) { saveRosters(); publish(); }
    }
    /** Add start lists from files: Meet Manager .scb files, or captures of the scoreboard link. */
    async function loadEventData(files) {
        hideError();
        const heats = new Set(), events = new Set(), failed = [], at = Date.now();
        let read = 0, added = 0;
        // A file can add hundreds of heats at once: list what it replaced or removed, and total the rest.
        const noteFile = (result, name) => { if (result.status === 'added') added++; else note(result, name, at); };
        for (const file of files) {
            try {
                if (file.size > 50 * 1024 * 1024) throw new Error('larger than 50 MB');
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (/\.scb$/i.test(file.name)) {
                    const roster = CTS6.parseSCB(new TextDecoder('windows-1252').decode(bytes));
                    rosters.addEvent(roster, file.name, at).forEach(result => noteFile(result, file.name)); events.add(roster.event);
                    roster.heats.forEach((_, i) => heats.add(roster.event + '/' + (i + 1)));
                } else {
                    let records = GENSER.readCapture(new TextDecoder().decode(bytes));          // a capture log
                    if (!records.length) records = GENSER.readCapture(bytes);                   // or the bytes themselves
                    if (!records.length) throw new Error('no start lists found');
                    for (const record of records) { noteFile(rosters.add(record, file.name, at), file.name); events.add(record.event); heats.add(record.event + '/' + record.heat); }
                }
                read++;
            } catch (e) { failed.push(`${file.name} (${e.message || e})`); }
        }
        const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        if (added) { changes.unshift({ at, source: count(read, 'file'), kind: 'added', text: `${count(added, 'heat')} added` }); changeCount++; }
        if (read) { saveRosters(); lastSent = ''; publish(); }
        $('eventFileStatus').textContent = read ? `Read ${count(read, 'file')}: ${count(heats.size, 'heat')} in ${count(events.size, 'event')}.`
            : files.length ? 'Nothing was loaded.' : 'No files to read. A folder is searched for .scb files only.';
        if (failed.length) showError(new Error('Could not read event data from ' + failed.slice(0, 5).join('; ') + (failed.length > 5 ? `; and ${failed.length - 5} more` : '')));
        render();
    }
    const genser = new SerialLink(onGenserChunk, () => { parser.reset(); asked.clear(); askedFor = ''; }, () => {});
    function ask(event, heat, now, limit) {
        if (event > 999 || heat > 99 || now - lastAskAt < 1000) return;
        const key = event + '/' + heat, entry = asked.get(key) || { count: 0, at: -Infinity };
        if (entry.count >= limit || now - entry.at < 2500) return;
        entry.count++; entry.at = now; asked.set(key, entry); lastAskAt = now;
        genser.write(GENSER.request(event, heat)).catch(showError);
    }
    function requestStartLists(now) {
        if (!$('genserRequest').checked || !genser.connected || !latest.event || !latest.heat) return;
        const key = latest.event + '/' + latest.heat;
        if (key !== askedFor) { askedFor = key; asked.clear(); }        // new heat: fetch it again, entries may have changed
        const have = rosters.has(latest.event, latest.heat);
        ask(latest.event, latest.heat, now, have ? 1 : 5);
        if (have) ask(latest.event, latest.heat + 1, now, 1);            // look ahead; silence means no such heat
    }

    // ---- output --------------------------------------------------------------------------
    const view = () => rosters.view({ firstLast: $('firstLast').checked });
    const output = () => CTS6.payload(latest, view(), { placedTimesAreFinal: $('finals').checked, trustReset: $('resetState').checked });
    function stopPublishing() { $('publish').checked = false; lastSent = ''; }
    function publish() {
        if (!$('publish').checked || !timerLive() || !latest.event || !latest.heat) return;
        const data = output(), serialized = JSON.stringify(data), now = performance.now();
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        channel.postMessage(data); relay.send(serialized); obs.send(data);
        lastSent = serialized; lastSendAt = now; sent++;
    }
    function linkStatus(id, button, labels) {
        return (state, message) => {
            const el = $(id); el.textContent = message || labels.idle;
            el.className = 'small' + (state === 'open' ? ' status-ok' : state === 'retrying' || state === 'error' ? ' status-warn' : '');
            $(button).textContent = state === 'closed' || state === 'error' ? labels.connect : labels.disconnect;
        };
    }
    const relay = new BridgeLinks.RelayLink(linkStatus('relayStatus', 'relay', { idle: 'Not connected.', connect: 'Connect relay', disconnect: 'Disconnect relay' }));
    const obs = new BridgeLinks.ObsLink(linkStatus('obsStatus', 'obs', { idle: 'Not connected.', connect: 'Connect OBS', disconnect: 'Disconnect OBS' }));

    // ---- display -------------------------------------------------------------------------
    const serialSettings = prefix => ({ baudRate: Number($(prefix + 'Baud').value), dataBits: 8, stopBits: 1, parity: $(prefix + 'Parity').value, flowControl: 'none' });
    const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
    const clockTime = at => at ? new Date(at).toLocaleTimeString() : '';
    /** The event data viewer: every heat held for one event, where it came from, and what changed lately. */
    function renderViewer() {
        const map = view(), events = [...map.keys()].sort((a, b) => a - b);
        const count = e => map.get(e).heats.filter(Boolean).length;
        const labels = events.map(e => `${e} · ${map.get(e).title || 'No title'} · ${count(e)} heat${count(e) === 1 ? '' : 's'}`);
        if (labels.join('\n') !== optionsKey) {                         // rebuild only when the list itself changes, so an open menu is left alone
            optionsKey = labels.join('\n');
            const chosen = $('viewEvent').value;
            $('viewEvent').replaceChildren(...events.map((e, i) => { const o = el('option', labels[i]); o.value = e; return o; }));
            if (map.has(Number(chosen))) $('viewEvent').value = chosen;
        }
        if ($('viewFollow').checked && map.has(latest.event)) $('viewEvent').value = latest.event;
        const selected = events.length ? Number($('viewEvent').value) : null, entry = map.get(selected);
        const key = [rosters.version, selected, $('firstLast').checked, latest.event, latest.heat, changeCount, unchanged].join('|');
        if (key === viewKey) return;
        viewKey = key;
        const newest = [...rosters.events.values()].flatMap(e => e.info).filter(i => i?.at).sort((a, b) => b.at - a.at)[0];
        $('viewSummary').textContent = !events.length ? 'No event data yet.'
            : `${events.length} event${events.length === 1 ? '' : 's'} · ${rosters.heats} heat${rosters.heats === 1 ? '' : 's'}` + (newest ? ` · newest ${clockTime(newest.at)} from ${newest.source || 'an earlier visit'}` : '');
        $('viewHeats').replaceChildren(...(entry ? Array.from(entry.heats, (heat, i) => {
            const current = selected === latest.event && i + 1 === latest.heat, info = entry.info[i];
            const box = el('div', undefined, 'heat' + (current ? ' current' : '')), head = el('p');
            head.append(el('strong', `Heat ${i + 1}`), heat ? [info?.source || 'saved earlier', clockTime(info?.at)].filter(Boolean).join(' · ') : 'not received');
            if (current) head.append(' ', el('span', 'ON THE TIMER', 'badge'));
            box.append(head);
            if (heat) {
                const table = el('table'), body = el('tbody');
                heat.forEach((a, lane) => { const tr = el('tr'); tr.append(el('td', String(lane + 1)), el('td', a.name || '—'), el('td', a.team || '—')); body.append(tr); });
                table.append(body); box.append(table);
            }
            return box;
        }) : [el('p', 'Load a file or connect to serial to see event data here.', 'small')]));
        const rows = changes.slice(0, 60).map(c => el('li', `${clockTime(c.at)} · ${c.source} · ${c.text}`, c.kind));
        if (unchanged) rows.push(el('li', `${unchanged.toLocaleString()} start list${unchanged === 1 ? '' : 's'} arrived again with nothing changed.`));
        $('viewChanges').replaceChildren(...(rows.length ? rows : [el('li', 'Nothing received in this visit.')]));
    }
    function render() {
        renderViewer();
        const map = view(), roster = map.get(latest.event), heat = roster?.heats[latest.heat - 1];
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('title').textContent = roster?.title || (latest.event ? 'No start list for this event yet' : 'Waiting for the timer stream');
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        $('rosterStatus').textContent = heat ? 'Start list matched' : latest.event ? 'Start list missing' : 'No start list';
        $('lanes').replaceChildren(...latest.lanes.map((lane, i) => {
            const tr = document.createElement('tr');
            [lane.lane, heat?.[i]?.name || '—', heat?.[i]?.team || '—', lane.place || '—', lane.time || '—', lane.followsClock ? 'Running clock' : 'Lane display'].forEach(value => {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            });
            return tr;
        }));
        const support = 'serial' in navigator;
        const busy = timer.connected || timer.opening;
        $('timerFile').disabled = busy;
        ['timerPlay', 'timerRestart', 'timerSeek', 'timerClose'].forEach(id => $(id).disabled = !replay);
        $('timerPlay').textContent = replay?.playing ? 'Pause' : 'Play';
        $('timerSeek').max = replay?.duration || 1; $('timerSeek').value = replay?.at || 0;
        $('timerPosition').textContent = replay ? `${elapsed(replay.at)} / ${elapsed(replay.duration)}` : '00:00 / 00:00';
        const warn = !!replay?.note;
        $('timerFileStatus').className = 'small' + (warn ? ' status-warn' : '');
        $('timerFileStatus').textContent = !replay ? (busy ? 'Disconnect the port to replay a capture.' : 'No capture loaded.')
            : `${replay.name} · ${replay.playing ? 'playing' : replay.at >= replay.duration ? 'finished' : 'paused'} · ${latest.bytes.toLocaleString()} bytes so far.${replay.note}`;
        $('timerConnect').disabled = !support || timer.connected || timer.opening;
        $('timerDisconnect').disabled = !timer.connected || timer.closing;
        $('genserConnect').disabled = !support || genser.connected || genser.opening;
        $('genserDisconnect').disabled = !genser.connected || genser.closing;
        ['timerBaud', 'timerParity'].forEach(id => $(id).disabled = timer.connected || timer.opening);
        ['genserBaud', 'genserParity'].forEach(id => $(id).disabled = genser.connected || genser.opening);
        if (support) {
            $('timerStatus').textContent = timer.connected
                ? (latest.bytes ? (latest.blocks ? 'Connected · receiving' : 'Connected · bytes arriving but nothing decodes. Check baud and parity.') : 'Connected · no data yet')
                : 'Not connected. The console sends 9600 baud with even parity.';
            $('genserStatus').textContent = !genser.connected ? 'Not connected. Tap the line that Meet Manager transmits on.'
                : parser.records ? 'Connected · receiving start lists'
                : parser.requests ? 'Connected · seeing requests but no start lists. This is the scoreboard computer’s transmit line; move the tap to Meet Manager’s.'
                : parser.bytes ? 'Connected · bytes arriving but no start list yet' : 'Connected · no data yet. Meet Manager only sends when asked.';
        }
        $('sourceStatus').textContent = (timer.connected ? 'Timer connected' : replay ? (replay.playing ? 'Timer: capture playing' : 'Timer: capture paused') : 'Timer not connected') + ' · '
            + (rosters.heats ? `Event data: ${rosters.heats} heats` : 'No event data') + (genser.connected ? ' · serial connected' : '');
        $('rosterSummary').textContent = rosters.heats ? `${rosters.heats} heats saved across ${rosters.events.size} events` : 'No event data saved';
        $('bytes').textContent = latest.bytes.toLocaleString(); $('blocks').textContent = latest.blocks.toLocaleString();
        const steps = clock.steps;
        $('clockRate').textContent = steps.length ? (steps.length / 10).toFixed(1) : '—';
        $('clockGap').textContent = steps.length ? Math.round(Math.max(...steps.map(s => s.gap))) + ' ms' : '—';
        $('clockSkipped').textContent = clock.skipped;
        $('readErrors').textContent = `${timer.readErrors} / ${genser.readErrors}`;
        $('gBytes').textContent = parser.bytes.toLocaleString(); $('gRecords').textContent = parser.records.toLocaleString();
        $('gDiscarded').textContent = parser.discarded.toLocaleString(); $('sent').textContent = sent.toLocaleString();
        $('genserLast').textContent = lastRecord
            ? `Last start list: event ${lastRecord.event} heat ${lastRecord.heat} · ${lastRecord.title} · ${lastRecord.lanes.filter(l => l.name).length} lanes · ${Math.round((performance.now() - lastRecordAt) / 1000)} s ago`
            : 'No start list received yet.';
        $('publishStatus').textContent = !$('publish').checked ? 'Publishing is off.'
            : !timerLive() ? 'Waiting: connect the timer port or play a capture.'
            : !(latest.event && latest.heat) ? 'Waiting: no event and heat decoded yet.'
            : 'Publishing' + [relay.open && ' · relay', obs.open && ' · OBS'].filter(Boolean).join('') + ' · browser tabs';
        $('channels').textContent = ' CH  DISPLAY   UNIVERSAL  RAW DIGITS                 FORMAT\n' + latest.channels.map(c =>
            `${String(c.channel).padStart(3)}  ${c.display}  ${c.universal ? 'yes' : 'no '}        ${c.readout.map(v => v === null ? '-' : v.toString(16)).join(' ')}           ${c.format.map(v => v === null ? '-' : v.toString(16)).join(' ')}`).join('\n');
        if ($('json').closest('details').open) $('json').textContent = JSON.stringify(output(), null, 2);
    }

    // ---- settings ------------------------------------------------------------------------
    const SAVED = ['timerBaud', 'timerParity', 'genserBaud', 'genserParity', 'relayUrl', 'obsUrl'];
    function saveSettings() {
        const s = { firstLast: $('firstLast').checked };
        SAVED.forEach(id => s[id] = $(id).value);
        try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    }
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS) || '{}');
        SAVED.forEach(id => { if (typeof s[id] === 'string' && s[id]) $(id).value = s[id]; });
        if (typeof s.firstLast === 'boolean') $('firstLast').checked = s.firstLast;
        rosters = GENSER.RosterStore.fromJSON(JSON.parse(localStorage.getItem(ROSTERS) || '[]'));
    } catch (e) { /* ignore damaged storage */ }

    // ---- wiring --------------------------------------------------------------------------
    $('timerConnect').onclick = () => timer.connect(serialSettings('timer'), genser);
    $('timerDisconnect').onclick = () => timer.disconnect();
    $('genserConnect').onclick = () => genser.connect(serialSettings('genser'), timer);
    $('genserDisconnect').onclick = () => genser.disconnect();
    $('timerFile').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) loadTimerCapture(file); };
    $('timerPlay').onclick = () => {
        if (!replay) return;
        if (!replay.playing && replay.at >= replay.duration) seekReplay(0);
        replay.playing = !replay.playing; replay.lastTick = performance.now(); render();
    };
    $('timerRestart').onclick = () => { if (replay) { seekReplay(0); replay.lastTick = performance.now(); render(); } };
    $('timerSeek').oninput = e => { if (replay) { seekReplay(Number(e.target.value)); replay.lastTick = performance.now(); render(); } };
    $('timerSpeed').onchange = () => { if (replay) replay.lastTick = performance.now(); };
    $('timerClose').onclick = () => { replay = null; resetTimer(); lastSent = ''; render(); };
    const chosen = filter => e => { const files = Array.from(e.target.files).filter(filter); e.target.value = ''; loadEventData(files); };
    $('eventFiles').onchange = chosen(() => true);
    $('eventFolder').onchange = chosen(file => /\.scb$/i.test(file.name));
    $('viewEvent').onchange = () => { $('viewFollow').checked = false; render(); };
    $('viewFollow').onchange = render;
    $('clearRosters').onclick = () => { rosters.clear(); lastRecord = null; unchanged = 0; changes.unshift({ at: Date.now(), source: 'this page', kind: 'removed', text: 'All saved event data cleared' }); changeCount++; try { localStorage.removeItem(ROSTERS); } catch (e) { /* storage blocked */ } lastSent = ''; render(); };
    $('relay').onclick = () => { hideError(); try { if (relay.active) relay.disconnect(); else relay.connect($('relayUrl').value); saveSettings(); } catch (e) { showError(e); } };
    $('obs').onclick = () => { hideError(); try { if (obs.active) obs.disconnect(); else obs.connect($('obsUrl').value, $('obsPassword').value); saveSettings(); } catch (e) { showError(e); } };
    ['publish', 'finals', 'resetState', 'firstLast'].forEach(id => $(id).onchange = () => { lastSent = ''; saveSettings(); publish(); render(); });
    SAVED.forEach(id => $(id).addEventListener('change', saveSettings));
    $('export').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(output(), null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'serial-bridge-scoreboard.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (!('serial' in navigator)) {
        $('timerStatus').textContent = $('genserStatus').textContent = 'Web Serial is not available here. Open this page in desktop Chrome or Edge, over localhost or HTTPS.';
    }
    setInterval(stepReplay, 25);
    setInterval(() => {
        const now = performance.now();
        if (timer.connected) latest = decoder.snapshot(now - timerStart);
        requestStartLists(now); publish(); render();
    }, 100);
    render();
})();
