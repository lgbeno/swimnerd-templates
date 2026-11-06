/* Outbound links for the serial bridge.
 *
 * A web page cannot accept WebSocket connections, so something else must sit between
 * this page and an OBS Browser Source. Two options are supported:
 *   RelayLink - the relay in websocket-test-server/, which re-sends every message to all clients.
 *   ObsLink   - OBS Studio's own WebSocket server (obs-websocket v5). The obs-browser vendor
 *               request "emit_event" delivers the data to every Browser Source as a window event.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BridgeLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const RETRY_MS = 3000;
    function socketUrl(value) {
        const url = new URL(value);
        if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Address must start with ws:// or wss://');
        return url.href;
    }

    class Link {
        constructor(onStatus) { this.onStatus = onStatus || (() => {}); this.socket = null; this.url = null; this.timer = null; this.sent = 0; this.ready = false; }
        get open() { return this.ready && this.socket?.readyState === 1; }
        get active() { return this.url !== null; }
        _retry(message) {
            this.ready = false; this.socket = null;
            if (this.url === null) return;
            this.onStatus('retrying', message);
            clearTimeout(this.timer); this.timer = setTimeout(() => this._open(), RETRY_MS);
        }
        _stop(state, message) {
            this.url = null; this.ready = false; clearTimeout(this.timer);
            const socket = this.socket; this.socket = null;
            if (socket) { socket.onclose = null; try { socket.close(); } catch (e) { /* already closed */ } }
            this.onStatus(state, message);
        }
        disconnect() { this._stop('closed', 'Disconnected'); }
    }

    class RelayLink extends Link {
        connect(url) { this._stop('closed', ''); this.url = socketUrl(url); this._open(); }
        _open() {
            let socket;
            try { socket = new WebSocket(this.url); } catch (e) { this._stop('error', e.message); return; }
            this.socket = socket; this.onStatus('connecting', 'Connecting…');
            socket.onopen = () => { if (this.socket === socket) { this.ready = true; this.onStatus('open', 'Connected'); } };
            socket.onmessage = () => {};          // the relay echoes our own messages back
            socket.onerror = () => {};
            socket.onclose = () => { if (this.socket === socket) this._retry('Not reachable. Retrying…'); };
        }
        send(text) { if (!this.open) return false; this.socket.send(text); this.sent++; return true; }
    }

    async function digest(value) {
        if (!globalThis.crypto?.subtle) throw new Error('Password hashing needs a secure page (localhost or HTTPS)');
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
        let binary = ''; for (const b of hash) binary += String.fromCharCode(b);
        return btoa(binary);
    }
    /** obs-websocket v5: base64(sha256(base64(sha256(password + salt)) + challenge)). */
    async function authentication(password, salt, challenge) { return digest(await digest(password + salt) + challenge); }
    const FATAL = { 4009: 'OBS rejected the password.', 4010: 'OBS does not support this protocol version.', 4011: 'OBS ended the session.' };

    class ObsLink extends Link {
        constructor(onStatus, eventName = 'swimnerd-scoreboard') { super(onStatus); this.eventName = eventName; this.password = ''; this.rejected = 0; this.requestId = 0; }
        connect(url, password = '') { this._stop('closed', ''); this.url = socketUrl(url); this.password = password; this.rejected = 0; this._open(); }
        _open() {
            let socket;
            try { socket = new WebSocket(this.url); } catch (e) { this._stop('error', e.message); return; }
            this.socket = socket; this.onStatus('connecting', 'Connecting…');
            socket.onerror = () => {};
            socket.onclose = e => {
                if (this.socket !== socket) return;
                if (FATAL[e.code]) this._stop('error', FATAL[e.code]);
                else this._retry('OBS not reachable. Retrying…');
            };
            socket.onmessage = async e => {
                let message; try { message = JSON.parse(e.data); } catch (err) { return; }
                const d = message.d || {};
                if (message.op === 0) {                                   // Hello
                    const identify = { rpcVersion: 1, eventSubscriptions: 0 };
                    try {
                        if (d.authentication) {
                            if (!this.password) throw new Error('OBS requires a password.');
                            identify.authentication = await authentication(this.password, d.authentication.salt, d.authentication.challenge);
                        }
                    } catch (err) { if (this.socket === socket) this._stop('error', err.message); return; }
                    if (this.socket === socket) socket.send(JSON.stringify({ op: 1, d: identify }));
                } else if (message.op === 2) {                            // Identified
                    this.ready = true; this.onStatus('open', 'Connected to OBS');
                } else if (message.op === 7 && d.requestStatus && !d.requestStatus.result) {   // RequestResponse
                    if (!this.rejected++) this.onStatus('open', 'OBS rejected the event: ' + (d.requestStatus.comment || 'code ' + d.requestStatus.code));
                }
            };
        }
        /** Deliver data to every Browser Source as window event `eventName`, with the data in event.detail. */
        send(data) {
            if (!this.open) return false;
            this.socket.send(JSON.stringify({ op: 6, d: { requestType: 'CallVendorRequest', requestId: String(++this.requestId),
                requestData: { vendorName: 'obs-browser', requestType: 'emit_event', requestData: { event_name: this.eventName, event_data: data } } } }));
            this.sent++; return true;
        }
    }
    return { RelayLink, ObsLink, authentication };
});
