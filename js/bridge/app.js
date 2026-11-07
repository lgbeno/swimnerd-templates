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
        for (const record of records) { rosters.add(record, 'serial', Date.now()); lastRecord = record; lastRecordAt = now; }
        if (records.length) { saveRosters(); publish(); }
    }
    const genser = new SerialLink(onGenserChunk, () => parser.reset(), () => {});

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
    function render() {
        const roster = rosters.view().get(latest.event), heat = roster?.heats[latest.heat - 1];
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('title').textContent = roster?.title || (latest.event ? 'No start list for this event yet' : 'Waiting for the timer');
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        $('lanes').replaceChildren(...latest.lanes.map((lane, i) => {
            const tr = document.createElement('tr');
            [lane.lane, heat?.[i]?.name || '—', heat?.[i]?.team || '—', lane.place || '—', lane.time || '—'].forEach(value => {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            });
            return tr;
        }));
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
        $('savedSummary').textContent = rosters.heats ? `${plural(rosters.heats, 'heat')} saved across ${plural(rosters.events.size, 'event')}` : 'No event data saved';
        $('clearRosters').hidden = !rosters.heats;
        $('sourceStatus').textContent = (timer.connected ? 'Timer connected' : 'Timer not connected') + ' · ' + (genser.connected ? 'Event data connected' : 'Event data not connected');
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
    $('clearRosters').onclick = () => { rosters.clear(); lastRecord = null; try { localStorage.removeItem(ROSTERS); } catch (e) { /* storage blocked */ } lastSent = ''; render(); };
    if (!('serial' in navigator)) {
        $('timerStatus').textContent = $('genserStatus').textContent = 'Web Serial is not available here. Open this page in desktop Chrome or Edge, over localhost or HTTPS.';
    }
    setInterval(() => {
        if (timer.connected) latest = decoder.snapshot(performance.now() - timerStart);
        publish(); render();
    }, 100);
    render();
})();
