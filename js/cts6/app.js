/* Browser controller: file imports, deterministic replay, read-only Web Serial. */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const channel = new BroadcastChannel('swimnerd-scoreboard');
    let rosters = new Map(), replay = null, decoder = new CTS6.Decoder();
    let source = 'none', playing = false, lastTick = performance.now(), sourceStart = 0;
    let port = null, reader = null, opening = false, closing = false, socket = null, importing = false;
    let latest = decoder.snapshot(0), lastSent = '', lastSendAt = 0;
    const elapsed = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    const error = e => { $('error').hidden = false; $('error').textContent = e.message || String(e); };
    function output() { return CTS6.payload(latest, rosters, { placedTimesAreFinal: $('finals').checked, trustReset: $('resetState').checked }); }
    function stopPublishing() { $('publish').checked = false; lastSent = ''; }
    function render() {
        const roster = rosters.get(latest.event), heat = roster?.heats[latest.heat - 1];
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('title').textContent = roster?.title || (latest.event ? 'No roster for this event' : 'Waiting for scoreboard data');
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        $('rosterStatus').textContent = heat ? 'Roster matched' : 'Roster missing';
        $('bytes').textContent = latest.bytes.toLocaleString(); $('blocks').textContent = latest.blocks.toLocaleString(); $('orphans').textContent = latest.orphans;
        $('lanes').replaceChildren(...latest.lanes.map((lane, i) => {
            const tr = document.createElement('tr');
            [lane.lane, heat?.[i]?.name || '—', heat?.[i]?.team || '—', lane.place || '—', lane.time || '—', lane.followsClock ? 'Running clock' : 'Lane display'].forEach(value => {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            }); return tr;
        }));
        $('channels').textContent = ' CH  DISPLAY   UNIVERSAL  RAW DIGITS                 FORMAT\n' + latest.channels.map(c =>
            `${String(c.channel).padStart(3)}  ${c.display}  ${c.universal ? 'yes' : 'no '}        ${c.readout.map(v => v === null ? '-' : v.toString(16)).join(' ')}           ${c.format.map(v => v === null ? '-' : v.toString(16)).join(' ')}`).join('\n');
        const data = output(), serialized = JSON.stringify(data);
        $('json').textContent = JSON.stringify(data, null, 2);
        const now = performance.now();
        if ($('publish').checked && source !== 'none' && (source === 'live' || playing) && latest.event && latest.heat &&
            (serialized !== lastSent || now - lastSendAt >= 1000)) {
            channel.postMessage(data);
            if (socket?.readyState === WebSocket.OPEN) socket.send(serialized);
            lastSent = serialized; lastSendAt = now;
        }
        $('play').textContent = playing ? 'Pause' : 'Play';
        $('play').disabled = !replay || source === 'live' || opening || importing;
        $('restart').disabled = $('play').disabled; $('seek').disabled = $('play').disabled;
        $('connect').disabled = !!port || opening || importing || !('serial' in navigator);
        $('disconnect').disabled = !port || closing;
        $('files').disabled = !!port || opening || importing; $('folder').disabled = $('files').disabled;
        if (replay && source === 'replay') {
            $('seek').max = replay.duration || 1; $('seek').value = replay.at;
            $('position').textContent = `${elapsed(replay.at)} / ${elapsed(replay.duration)}`;
        }
    }
    async function load(files) {
        if (port || opening || importing) return;
        importing = true; playing = false; stopPublishing(); render(); $('error').hidden = true;
        try {
            const selected = Array.from(files).filter(f => /\.(csv|scb)$/i.test(f.name));
            const captures = selected.filter(f => /\.csv$/i.test(f.name));
            if (!selected.length) throw new Error('Choose the extracted meet folder or CSV/.scb files. Unzip the archive first.');
            if (captures.length > 1) throw new Error('Choose only one serial capture CSV at a time.');
            let nextReplay = replay;
            const nextRosters = captures.length ? new Map() : new Map(rosters);
            for (const file of selected) {
                if (file.size > 50 * 1024 * 1024) throw new Error('File exceeds 50 MB limit: ' + file.name);
                if (/\.csv$/i.test(file.name)) nextReplay = new CTS6.Replay(CTS6.parseCapture(await file.text()));
                else {
                    const roster = CTS6.parseSCB(new TextDecoder('windows-1252').decode(await file.arrayBuffer()));
                    nextRosters.set(roster.event, roster);
                }
            }
            rosters = nextRosters; replay = nextReplay;
            if (replay) { source = 'replay'; latest = replay.seek(0); $('sourceStatus').textContent = 'Capture ready · replay paused'; }
            $('fileStatus').textContent = `${rosters.size} event rosters · ${replay ? replay.chunks.length.toLocaleString() + ' serial chunks · ' + elapsed(replay.duration) : 'No capture loaded'}`;
        } catch (e) { error(e); }
        finally { importing = false; render(); }
    }
    $('files').onchange = e => load(e.target.files); $('folder').onchange = e => load(e.target.files);
    $('play').onclick = () => {
        if (!replay || source === 'live') return;
        if (!playing && replay.at >= replay.duration) { stopPublishing(); latest = replay.seek(0); }
        source = 'replay'; playing = !playing; lastTick = performance.now();
        if (!playing) stopPublishing();
        $('sourceStatus').textContent = playing ? 'Capture replay · playing' : 'Capture replay · paused'; render();
    };
    function seek(at) { playing = false; stopPublishing(); latest = replay.seek(at); $('sourceStatus').textContent = 'Capture replay · paused'; render(); }
    $('restart').onclick = () => seek(0); $('seek').oninput = e => seek(Number(e.target.value));
    $('speed').onchange = () => { lastTick = performance.now(); };
    async function connect() {
        if (port || opening) return;
        opening = true; playing = false; stopPublishing(); $('error').hidden = true; render();
        try {
            const selected = await navigator.serial.requestPort();
            await selected.open({ baudRate: Number($('baud').value), dataBits: 8, stopBits: 1, parity: $('parity').value, flowControl: 'none' });
            port = selected; opening = false; closing = false; source = 'live'; decoder = new CTS6.Decoder(); latest = decoder.snapshot(0); sourceStart = performance.now();
            $('sourceStatus').textContent = 'Live serial · connected'; $('serialStatus').textContent = 'Connected · receiving only; no commands sent'; render();
            reader = port.readable.getReader();
            while (!closing) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) decoder.feed(value, performance.now() - sourceStart);
            }
        } catch (e) { if (e.name !== 'NotFoundError') error(e); }
        finally {
            if (reader) { reader.releaseLock(); reader = null; }
            if (port) { try { await port.close(); } catch (e) { error(e); } }
            port = null; opening = false; closing = false; stopPublishing();
            if (source === 'live') { source = 'none'; latest = decoder.snapshot(Infinity); }
            $('sourceStatus').textContent = 'Serial disconnected'; $('serialStatus').textContent = 'Disconnected · no idle state inferred'; render();
        }
    }
    $('connect').onclick = connect;
    $('disconnect').onclick = async () => { closing = true; stopPublishing(); render(); if (reader) { try { await reader.cancel(); } catch (e) { error(e); } } };
    $('relay').onclick = () => {
        if (socket) { socket.close(); return; }
        try {
            const url = new URL($('relayUrl').value);
            if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Relay must use ws:// or wss://');
            const current = new WebSocket(url.href); socket = current; $('relay').textContent = 'Disconnect relay';
            $('relayStatus').textContent = 'Relay connecting…';
            current.onopen = () => { $('relayStatus').textContent = 'Relay connected. Enable publishing to send.'; };
            current.onerror = () => { $('relayStatus').textContent = 'Relay connection failed. Check the server and URL.'; };
            current.onclose = () => { if (socket === current) { socket = null; $('relay').textContent = 'Connect relay'; $('relayStatus').textContent = 'Relay disconnected'; } };
        } catch (e) { error(e); }
    };
    ['publish', 'finals', 'resetState'].forEach(id => $(id).onchange = () => { lastSent = ''; render(); });
    $('export').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(output(), null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'cts6-scoreboard.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (!('serial' in navigator)) $('serialStatus').textContent = 'Web Serial unavailable here. Open in desktop Chrome/Edge over localhost or HTTPS. Capture replay still works.';
    setInterval(() => {
        const now = performance.now(), delta = now - lastTick; lastTick = now;
        if (playing && replay) {
            latest = replay.seek(replay.at + delta * Number($('speed').value));
            if (replay.at >= replay.duration) { playing = false; stopPublishing(); $('sourceStatus').textContent = 'Capture replay · complete'; }
        } else if (source === 'live') latest = decoder.snapshot(now - sourceStart);
        render();
    }, 100);
    render();
})();
