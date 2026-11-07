/* Serial bridge: the timer and Meet Manager in over two serial ports, one overlay feed out.
 *
 *   timer port        -> CTS6.Decoder        (clock, lanes, event and heat)
 *   Meet Manager port -> GENSER.StreamParser -> GENSER.RosterStore (titles, names, teams)
 *   both              -> CTS6.payload()      -> BroadcastChannel 'swimnerd-scoreboard'
 */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    // Simulated start lists are stored apart, so made-up names never turn up at a real meet.
    const SETTINGS = 'swimnerd-bridge-settings', ROSTERS = 'swimnerd-bridge-rosters' + (globalThis.SerialSim?.active ? '-simulated' : '');
    // What each link sends. The page uses these unless the port settings dialog says otherwise.
    const DEFAULTS = { timer: { baud: '9600', parity: 'even' }, genser: { baud: '9600', parity: 'none' } };
    const channel = new BroadcastChannel('swimnerd-scoreboard');
    const parser = new GENSER.StreamParser();
    let decoder = new CTS6.Decoder(), latest = decoder.snapshot(0), timerStart = performance.now();
    let rosters = new GENSER.RosterStore(), lastRecord = null, lastRecordAt = null, saveTimer = null;
    let lastStartList = null;   // the newest start list to arrive, from either source: { event, heat, title, lanes, source, at }
    const selected = { event: null, heat: 1 };   // the start list shown in the Event data box
    let following = true, steppedAwayAt = 0;     // the selection moves to each start list as it arrives, until the user steps away
    function arrived(event, heat, title, lanes, source, at) {
        lastStartList = { event, heat, title, lanes, source, at };
        if (following) { selected.event = event; selected.heat = heat; }
    }
    let lastSent = '', lastSendAt = 0;

    const showError = e => { $('error').hidden = false; $('error').textContent = e.message || String(e); };
    const hideError = () => { $('error').hidden = true; };

    /** One Web Serial port with a read loop that survives recoverable line errors. */
    class SerialLink {
        constructor(onChunk, onOpen, onClose) {
            this.onChunk = onChunk; this.onOpen = onOpen; this.onClose = onClose;
            this.port = null; this.reader = null; this.opening = false; this.closing = false;
        }
        get connected() { return !!this.port; }
        async connect(options, other) {
            if (this.port || this.opening) return;
            this.opening = true; hideError(); render();
            try {
                const selected = await navigator.serial.requestPort();
                if (other && selected === other.port) throw new Error('That port is already connected as the other one. Choose a different port.');
                await selected.open(options);
                this.port = selected; this.opening = false; this.closing = false;
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
                        const now = performance.now(); recent = recent.filter(t => now - t < 2000); recent.push(now);
                        if (e.name === 'NetworkError') throw e;
                        if (recent.length > 20) throw new Error('Too many serial errors (' + (e.message || e.name) + '). Is this the right port?');
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
    }

    // ---- timer ---------------------------------------------------------------------------
    function feedTimer(chunk, at) {
        let sequence = decoder.clockSequence;
        // Publish at every completed clock block, so two ticks that arrive in one read both go out.
        for (let i = 0; i < chunk.length; i++) {
            decoder.feed(chunk.subarray(i, i + 1), at);
            if (decoder.clockSequence !== sequence) { sequence = decoder.clockSequence; latest = decoder.snapshot(at); publish(); }
        }
        latest = decoder.snapshot(at); publish();
    }
    const timer = new SerialLink(chunk => feedTimer(chunk, performance.now() - timerStart),
        () => { decoder = new CTS6.Decoder(); latest = decoder.snapshot(0); timerStart = performance.now(); },
        () => { latest = decoder.snapshot(Infinity); lastSent = ''; });

    // ---- event data ----------------------------------------------------------------------
    function saveRosters() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { localStorage.setItem(ROSTERS, JSON.stringify(rosters)); } catch (e) { /* storage full or blocked */ } }, 500);
    }
    function onGenserChunk(chunk) {
        const now = performance.now(), records = parser.feed(chunk, now);
        for (const record of records) {
            rosters.add(record, 'serial', Date.now()); lastRecord = record; lastRecordAt = now;
            arrived(record.event, record.heat, record.title, record.lanes, 'serial', Date.now());
        }
        if (records.length) { saveRosters(); publish(); }
    }
    const genser = new SerialLink(onGenserChunk, () => parser.reset(), () => {});
    /** Load Meet Manager start-list files (.scb, one event each). A file replaces its whole event. */
    async function loadEventFiles(files) {
        hideError();
        const failed = [], at = Date.now();
        let events = 0, heats = 0;
        for (const file of files) {
            try {
                if (!/\.scb$/i.test(file.name)) throw new Error('not an .scb file');
                if (file.size > 5 * 1024 * 1024) throw new Error('larger than 5 MB');
                const roster = CTS6.parseSCB(new TextDecoder('windows-1252').decode(await file.arrayBuffer()));
                rosters.addEvent(roster, file.name, at); events++; heats += roster.heats.length;
                arrived(roster.event, 1, roster.title, roster.heats[0], file.name, at);
            } catch (e) { failed.push(`${file.name} (${e.message || e})`); }
        }
        if (events) { saveRosters(); lastSent = ''; publish(); }
        $('eventFileStatus').textContent = events ? `Loaded ${plural(events, 'event')}, ${plural(heats, 'heat')}.` : 'Nothing loaded.';
        if (failed.length) showError(new Error('Could not read ' + failed.slice(0, 5).join('; ') + (failed.length > 5 ? `; and ${failed.length - 5} more` : '')));
        render();
    }
    /** Write every stored event to a folder as Meet Manager .scb files, E001.scb and so on. */
    async function saveEventFiles() {
        hideError();
        if (typeof window.showDirectoryPicker !== 'function') { showError(new Error('Saving to a folder needs desktop Chrome or Edge.')); return; }
        try {
            const folder = await window.showDirectoryPicker({ mode: 'readwrite' });
            let files = 0;
            for (const entry of rosters.events.values()) {
                const text = CTS6.formatSCB(entry);
                const bytes = Uint8Array.from(text, ch => { const code = ch.charCodeAt(0); return code < 256 ? code : 0x3f; });   // windows-1252, as Meet Manager writes it
                const handle = await folder.getFileHandle(`E${String(entry.event).padStart(3, '0')}.scb`, { create: true });
                const writable = await handle.createWritable(); await writable.write(bytes); await writable.close(); files++;
            }
            $('eventFileStatus').textContent = files ? `Saved ${plural(files, 'file')} to ${folder.name}.` : 'Nothing to save.';
        } catch (e) { if (e.name !== 'AbortError') showError(e); }
        render();
    }

    // ---- output --------------------------------------------------------------------------
    function publish() {
        if (!timer.connected || !latest.event || !latest.heat) return;
        const data = CTS6.payload(latest, rosters.view(), { placedTimesAreFinal: false, trustReset: false });
        const serialized = JSON.stringify(data), now = performance.now();
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        channel.postMessage(data); lastSent = serialized; lastSendAt = now;
    }

    // ---- display -------------------------------------------------------------------------
    const serialSettings = prefix => ({ baudRate: Number($(prefix + 'Baud').value), dataBits: 8, stopBits: 1, parity: $(prefix + 'Parity').value, flowControl: 'none' });
    const customised = prefix => {
        const baud = $(prefix + 'Baud').value, parity = $(prefix + 'Parity').value;
        return baud === DEFAULTS[prefix].baud && parity === DEFAULTS[prefix].parity ? '' : ` · port set to ${baud} 8${parity[0].toUpperCase()}1`;
    };
    const withPort = (text, prefix) => customised(prefix) ? text.replace(/\.$/, '') + customised(prefix) : text;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const row = cells => {
        const tr = document.createElement('tr');
        for (const cell of cells) { const td = document.createElement('td'); td.textContent = cell.text ?? cell; if (cell.className) td.className = cell.className; tr.append(td); }
        return tr;
    };
    const clockTime = at => at ? new Date(at).toLocaleTimeString() : '';
    function render() {
        // Timer box: only what the console sends.
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        $('lanes').replaceChildren(...latest.lanes.map(lane => row([lane.lane, lane.place || '—',
            lane.time ? { text: lane.time, className: 'time' } : lane.followsClock && latest.clock ? { text: latest.clock, className: 'faint' } : '—'])));
        // Event data box: the selected start list, what arrived last, and how much is stored.
        const entry = selected.event ? rosters.events.get(selected.event) : null, heat = entry?.heats[selected.heat - 1], info = entry?.info[selected.heat - 1];
        if (document.activeElement !== $('viewEventNo')) $('viewEventNo').value = selected.event ?? '';
        if (document.activeElement !== $('viewHeatNo')) $('viewHeatNo').value = selected.event ? selected.heat : '';
        $('viewTitle').textContent = !selected.event ? (rosters.heats ? 'Step to an event, or type its number.' : 'No event data')
            : !entry ? `Nothing stored for event ${selected.event}`
            : (entry.title || 'No title') + (heat ? ` · heat ${selected.heat} of ${entry.heats.length} · ${info?.source || 'saved earlier'} ${clockTime(info?.at)}` : ` · heat ${selected.heat} not received`);
        $('startList').replaceChildren(...(heat ? heat.map((a, i) => row([i + 1, GENSER.displayName(a.name) || '—', a.team || '—'])) : []));
        $('lastReceived').textContent = lastStartList ? `Last received: event ${lastStartList.event} heat ${lastStartList.heat} · ${lastStartList.source} ${clockTime(lastStartList.at)}` : 'Nothing received in this visit';
        // The Latest latch: lit while following; when off, it flags a start list that arrived since the user stepped away.
        const unseen = !following && !!lastStartList && lastStartList.at > steppedAwayAt && (lastStartList.event !== selected.event || lastStartList.heat !== selected.heat);
        $('follow').setAttribute('aria-pressed', String(following));
        $('follow').classList.toggle('new', unseen);
        $('follow').textContent = unseen ? 'New' : 'Latest';
        $('storedEvents').textContent = rosters.events.size;
        $('storedHeats').textContent = `${plural(rosters.events.size, 'event')}, ${plural(rosters.heats, 'heat')}`;
        $('saveFiles').disabled = !rosters.events.size;
        const support = 'serial' in navigator;
        for (const [prefix, link] of [['timer', timer], ['genser', genser]]) {
            $(prefix + 'Connect').disabled = !support || link.connected || link.opening;
            $(prefix + 'Disconnect').disabled = !link.connected || link.closing;
            $(prefix + 'Settings').disabled = link.connected || link.opening;
        }
        if (support) {
            $('timerStatus').textContent = withPort(timer.opening ? 'Connecting…' : !timer.connected ? 'Not connected.'
                : !latest.bytes ? 'Connected · no data yet'
                : latest.blocks ? 'Connected · receiving' : 'Connected · bytes arriving but nothing decodes. Is this the console’s line?', 'timer');
            $('genserStatus').textContent = withPort(genser.opening ? 'Connecting…' : !genser.connected ? 'Not connected.'
                : parser.records ? `Connected · ${plural(parser.records, 'start list')} received · last was event ${lastRecord.event} heat ${lastRecord.heat}, ${Math.round((performance.now() - lastRecordAt) / 1000)} s ago`
                : parser.requests ? 'Connected · this is the scoreboard computer’s line, not Meet Manager’s. Move the tap to the other wire.'
                : parser.bytes ? 'Connected · bytes arriving, no start list yet' : 'Connected · waiting for Meet Manager', 'genser');
        }
        $('clearRosters').disabled = !rosters.heats && !lastStartList;
    }

    // ---- settings ------------------------------------------------------------------------
    const SAVED = ['timerBaud', 'timerParity', 'genserBaud', 'genserParity'];
    function saveSettings() {
        const s = {}; SAVED.forEach(id => s[id] = $(id).value);
        try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    }
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS) || '{}');
        SAVED.forEach(id => { if (typeof s[id] === 'string' && s[id]) $(id).value = s[id]; });
        rosters = GENSER.RosterStore.fromJSON(JSON.parse(localStorage.getItem(ROSTERS) || '[]'));
    } catch (e) { /* ignore damaged storage */ }

    // ---- wiring --------------------------------------------------------------------------
    $('timerConnect').onclick = () => timer.connect(serialSettings('timer'), genser);
    $('timerDisconnect').onclick = () => timer.disconnect();
    $('genserConnect').onclick = () => genser.connect(serialSettings('genser'), timer);
    $('genserDisconnect').onclick = () => genser.disconnect();
    for (const prefix of ['timer', 'genser']) {
        $(prefix + 'Settings').onclick = () => $(prefix + 'Dialog').showModal();
        $(prefix + 'Defaults').onclick = () => { $(prefix + 'Baud').value = DEFAULTS[prefix].baud; $(prefix + 'Parity').value = DEFAULTS[prefix].parity; saveSettings(); render(); };
        $(prefix + 'Dialog').onclose = render;
        [$(prefix + 'Baud'), $(prefix + 'Parity')].forEach(s => s.addEventListener('change', () => { saveSettings(); render(); }));
    }
    $('eventFiles').onchange = e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) loadEventFiles(files); };
    $('saveFiles').onclick = saveEventFiles;
    // Stepping the event goes through the events stored; typing a number shows that event, stored or not.
    const storedEvents = () => [...rosters.events.keys()].sort((a, b) => a - b);
    const heatsIn = event => rosters.events.get(event)?.heats.length || 1;
    const pick = (event, heat) => { selected.event = event; selected.heat = Math.max(1, Math.min(heat, 99)); following = false; steppedAwayAt = Date.now(); render(); };
    $('eventUp').onclick = () => { const next = storedEvents().find(e => e > (selected.event || 0)); if (next) pick(next, 1); };
    $('eventDown').onclick = () => { const prev = storedEvents().filter(e => e < (selected.event || Infinity)).pop(); if (prev) pick(prev, 1); };
    $('heatUp').onclick = () => { if (selected.event) pick(selected.event, Math.min(selected.heat + 1, heatsIn(selected.event))); };
    $('heatDown').onclick = () => { if (selected.event) pick(selected.event, selected.heat - 1); };
    $('viewEventNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (n >= 1 && n <= 999) pick(n, 1); else render(); };
    $('viewHeatNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (selected.event && n >= 1) pick(selected.event, n); else render(); };
    $('follow').onclick = () => {
        following = !following;
        if (following && lastStartList) { selected.event = lastStartList.event; selected.heat = lastStartList.heat; }
        else steppedAwayAt = Date.now();
        render();
    };
    $('clearRosters').onclick = () => { rosters.clear(); lastRecord = null; lastStartList = null; selected.event = null; selected.heat = 1; following = true; $('eventFileStatus').textContent = ''; try { localStorage.removeItem(ROSTERS); } catch (e) { /* storage blocked */ } lastSent = ''; render(); };
    if (!('serial' in navigator)) {
        $('timerStatus').textContent = $('genserStatus').textContent = 'Web Serial is not available here. Open this page in desktop Chrome or Edge, over localhost or HTTPS.';
    }
    setInterval(() => {
        if (timer.connected) latest = decoder.snapshot(performance.now() - timerStart);
        publish(); render();
    }, 100);
    render();
})();
