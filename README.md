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

## Creating a New Theme with Claude Code

You can use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to generate a complete theme from a written description.

### 1. Clone the repo

```bash
git clone https://github.com/lgbeno/swimnerd-templates.git
cd swimnerd-templates
```

### 2. Create your theme folder with a spec document

```bash
mkdir themes/my-theme
```

Write a design specification document and place it in your theme folder. This can be a `.docx`, `.md`, or `.txt` file describing the visual style you want. See `themes/spooky/Spooky Splash Spectacular Theme.docx` for an example of a spec that was used to generate the Spooky theme.

Your spec should cover:
- **Color palette** — primary, secondary, accent, and background colors
- **Typography** — font choices and sizing
- **Visual style** — gradients, borders, shadows, textures
- **Animations** — how elements appear, disappear, and transition
- **Decorative elements** — mascots, icons, or themed ornaments
- **Overall mood** — the theme or occasion (e.g., championship, holiday, school spirit)

### 3. Run Claude Code with the generate prompt

From the repo root, launch Claude Code and paste the following prompt (replace `my-theme` with your folder name):

```
Read my theme spec document in themes/my-theme/ and the theme authoring
guide at themes/THEME_SPEC.md. Use the default theme (themes/default/) as
a structural reference. Generate three complete overlay HTML files —
HeaderOverlay.html, LaneOverlay.html, and TimerOverlay.html — in
themes/my-theme/. Each file must link the shared structural CSS and JS
via ../../css/ and ../../js/ paths, and contain all theme-specific visual
CSS inline in a <style> tag. After generating the files, add my-theme to
the theme selector dropdown in Simulator.html. Finally, open Simulator.html
in the browser so I can preview the result.
```

### 4. Iterate

Review the overlays in the Simulator and give Claude Code feedback to refine colors, animations, sizing, or any other details until you're happy with the result.

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
├── js/                          # Shared overlay logic
│   ├── overlay-core.js
│   ├── lane-overlay.js
│   ├── timer-overlay.js
│   ├── header-overlay.js
│   ├── LogCompressor.js
│   └── test_log_compressor.js
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
