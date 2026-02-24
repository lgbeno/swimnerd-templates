# swimnerd-templates

A streaming overlay system for competitive swimming meets. Displays real-time race data (event info, lane results, running timer) through themed HTML overlays designed for use with OBS or similar broadcast software.

## Live Pages

- [Full Simulator Test Output](https://lgbeno.github.io/swimnerd-templates/Simulator.html)
- [Title Header Template](https://lgbeno.github.io/swimnerd-templates/themes/default/HeaderOverlay.html)
- [Lane Text Template](https://lgbeno.github.io/swimnerd-templates/themes/default/LaneOverlay.html)
- [Timer Template](https://lgbeno.github.io/swimnerd-templates/themes/default/TimerOverlay.html)
- [Data Logger](https://lgbeno.github.io/swimnerd-templates/DataLogger.html)

## Overview

The system consists of a **Simulator** that generates or manually inputs race data, and a set of **overlay templates** that render that data for broadcast. Communication between components uses the browser's BroadcastChannel API (same machine) and an optional WebSocket server (cross-machine).

### Overlay Templates

| Template | Description |
|----------|-------------|
| **HeaderOverlay** | Displays event number, heat number, and event name with marquee scrolling for long names. Includes animated transitions when events change. |
| **LaneOverlay** | Shows 8 lanes with athlete name, team, place, split times, and final times. Automatically switches between lineup and results views. |
| **TimerOverlay** | Running race clock in MM:SS.s format with an animated clock hand. Auto-hides when the timer goes stale. |

### Simulator

The Simulator page provides both manual and automated control:

- **Manual mode** -- Enter swimmer names, teams, and times directly. Data broadcasts on every change.
- **Single race simulation** -- Generates a realistic race with split times, final times, and place calculations.
- **Full meet simulation** -- Runs 5 events x 2 heats with 80+ real swimmer names and 16 team codes, including lineup display, race execution, and results hold.

### Data Logger

A utility page that connects to the WebSocket server and records all incoming messages with elapsed timestamps. Useful for debugging and capturing meet data for replay or analysis.

## Themes

Three themes are included:

- **Default** (`themes/default/`) -- Clean, professional look with semi-transparent dark backgrounds, suitable for broadcast.
- **Mario** (`themes/mario/`) -- Retro pixel-art style using the Press Start 2P font with pipe animations and Mario character effects.
- **Spooky** (`themes/spooky/`) -- Halloween-themed with eerie animations and effects.

Switch themes via the dropdown in the Simulator. See `themes/THEME_SPEC.md` for the full theme authoring guide.

## Setup

### Basic (Single Machine)

No server needed. Open `Simulator.html` in a browser and toggle "Show Preview" to see the overlays. Communication uses the BroadcastChannel API automatically.

### With WebSocket Server (Cross-Machine or Data Logger)

A WebSocket relay server is needed for cross-machine setups or to use the Data Logger. Two equivalent implementations are provided:

**Python:**
```bash
pip install websockets
python3 websocket-test-server/websocket-server.py
```

**Node.js:**
```bash
cd websocket-test-server && npm install
node websocket-test-server/websocket-server.js
```

Both run on port 8080 and relay all received messages to all connected clients.

### OBS Integration

Add each overlay as a Browser Source in OBS, pointing to the local file paths or hosted URLs:

- `HeaderOverlay.html` -- Event/heat info bar
- `LaneOverlay.html` -- Lane results panel
- `TimerOverlay.html` -- Running clock

For same-machine OBS, the BroadcastChannel works with no additional setup. For remote machines, run the WebSocket server and ensure both the Simulator and OBS machine can reach it.

## Data Format

The system broadcasts JSON in this structure:

```json
{
  "swimming": {
    "EventNumber": "1",
    "HeatNumber": "1",
    "EventName": "100m Freestyle",
    "RunningTime": "0:52.3",
    "LaneAthleteTeam": [
      {
        "LaneNumber": "1",
        "AthleteName": "Michael Phelps",
        "Team": "USA",
        "Place": "1",
        "SplitTime": "24.5",
        "FinalTime": "0:52.34"
      }
    ]
  }
}
```

## Project Structure

```
├── Simulator.html               # Main control interface
├── DataLogger.html              # WebSocket data logger
├── LogCompressor.js             # Log compression utility
├── js/                          # Shared overlay logic
│   ├── overlay-core.js
│   ├── lane-overlay.js
│   ├── timer-overlay.js
│   └── header-overlay.js
├── css/                         # Structural layout CSS
│   ├── lane-structure.css
│   ├── timer-structure.css
│   └── header-structure.css
├── themes/                      # Theme directories
│   ├── default/                 # Each has LaneOverlay, TimerOverlay, HeaderOverlay
│   ├── mario/
│   ├── spooky/
│   └── THEME_SPEC.md           # Theme authoring guide
├── websocket-test-server/       # WebSocket relay server
│   ├── websocket-server.js
│   └── websocket-server.py
└── README.md
```
