/**
 * SwimOverlay — shared infrastructure for all overlay pages.
 *
 * Provides WebSocket + BroadcastChannel connectivity, placeholder
 * hide-on-first-message logic, and shared utility functions.
 */
var SwimOverlay = (function () {
    let _onData = null;
    let _numLanes = 8;
    let _client = null;
    let _firstMessageReceived = false;

    function _handleMessage(data) {
        // Hide placeholder on first message
        if (!_firstMessageReceived) {
            _firstMessageReceived = true;
            const ph = document.getElementById('placeholder');
            if (ph) ph.classList.add('hidden');
        }
        if (_onData) _onData(data);
    }

    function _connectWebSocket() {
        try {
            _client = new WebSocket('ws://localhost:8080/');
            _client.onerror = () => console.log('WebSocket Connection Error');
            _client.onopen = () => console.log('WebSocket Client Connected');
            _client.onclose = () => {
                console.log('WebSocket Client Closed');
                setTimeout(_connectWebSocket, 3000);
            };
            _client.onmessage = (e) => _handleMessage(JSON.parse(e.data));
        } catch (e) {
            console.log('WebSocket not available');
        }
    }

    return {
        /** Initialise comms and wire up the data callback. */
        init: function (opts) {
            _onData = opts.onData;
            if (opts.numLanes) _numLanes = opts.numLanes;

            // BroadcastChannel
            const channel = new BroadcastChannel('swimnerd-scoreboard');
            channel.onmessage = (e) => _handleMessage(e.data);

            // WebSocket with auto-reconnect
            _connectWebSocket();
        },

        /** Number of lanes the overlay is configured for. */
        get numLanes() { return _numLanes; },

        /**
         * Returns true when every lane that has an assigned swimmer also
         * has a place. Iterates over the full LaneAthleteTeam array so it
         * is independent of the overlay's NUM_LANES display count.
         */
        checkAllActiveFinished: function (laneAthleteTeam) {
            let activeCount = 0;
            let finishedCount = 0;
            for (let i = 0; i < laneAthleteTeam.length; i++) {
                const lane = laneAthleteTeam[i];
                if (lane.LaneNumber && lane.LaneNumber.trim() !== '') {
                    activeCount++;
                    if (lane.Place && lane.Place.trim() !== '' && lane.Place.trim() !== ' ') {
                        finishedCount++;
                    }
                }
            }
            return activeCount > 0 && finishedCount === activeCount;
        },

        /** Ordinal suffix helper: 1 -> "1st", 2 -> "2nd", etc. */
        getPlaceText: function (place) {
            const num = parseInt(place);
            if (isNaN(num)) return place;
            const suffixes = ['th', 'st', 'nd', 'rd'];
            const v = num % 100;
            return num + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
        },

        /** Colors for lane indicator brick fragments. Themes can override. */
        fragmentColors: ['#FBD000', '#ff8800', '#c49800', '#ffe040'],

        /** Hook called when event number changes (for theme-specific effects). */
        onEventChange: null,

        /** Hook called when heat number changes (for theme-specific effects). */
        onHeatChange: null
    };
})();
