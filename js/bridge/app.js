/* Serial bridge controller: two Web Serial ports in, one overlay feed out.
 *
 *   timer port        -> CTS6.Decoder        (clock, lanes, event/heat)
 *   Meet Manager port -> GENSER.StreamParser (titles, names, teams)
 *   both              -> CTS6.payload()      -> BroadcastChannel, relay, OBS
 */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const SETTINGS = 'swimnerd-bridge-settings', ROSTERS = 'swimnerd-bridge-rosters';
    const channel = new BroadcastChannel('swimnerd-scoreboard');
    const parser = new GENSER.StreamParser();
    let decoder = new CTS6.Decoder(), latest = decoder.snapshot(0), timerStart = performance.now();
    let rosters = new GENSER.RosterStore(), lastRecord = null, lastRecordAt = null, saveTimer = null;
    let lastSent = '', lastSendAt = 0, sent = 0;
    const clock = { value: null, at: null, steps: [], skipped: 0 };
    const asked = new Map(); let askedFor = '', lastAskAt = -Infinity;

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
    function onTimerChunk(chunk) {
        const at = performance.now() - timerStart;
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
    const timer = new SerialLink(onTimerChunk,
        () => { decoder = new CTS6.Decoder(); timerStart = performance.now(); latest = decoder.snapshot(0); Object.assign(clock, { value: null, at: null, steps: [], skipped: 0 }); },
        () => { stopPublishing(); latest = decoder.snapshot(Infinity); });

    // ---- Meet Manager start lists --------------------------------------------------------
    function saveRosters() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { localStorage.setItem(ROSTERS, JSON.stringify(rosters)); } catch (e) { /* storage full or blocked */ } }, 500);
    }
    function onGenserChunk(chunk) {
        const now = performance.now(), records = parser.feed(chunk, now);
        for (const record of records) { rosters.add(record); lastRecord = record; lastRecordAt = now; }
        if (records.length) { saveRosters(); publish(); }
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
        if (!$('publish').checked || !timer.connected || !latest.event || !latest.heat) return;
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
    function render() {
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
        const ports = [timer.connected && 'timer', genser.connected && 'start lists'].filter(Boolean);
        $('sourceStatus').textContent = ports.length ? 'Connected: ' + ports.join(' + ') : 'No ports connected';
        $('rosterSummary').textContent = rosters.heats ? `${rosters.heats} heats saved across ${rosters.events.size} events` : 'No start lists saved';
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
            : !timer.connected ? 'Waiting: connect the timer port.'
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
    $('clearRosters').onclick = () => { rosters.clear(); lastRecord = null; try { localStorage.removeItem(ROSTERS); } catch (e) { /* storage blocked */ } lastSent = ''; render(); };
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
    setInterval(() => {
        const now = performance.now();
        if (timer.connected) latest = decoder.snapshot(now - timerStart);
        requestStartLists(now); publish(); render();
    }, 100);
    render();
})();
