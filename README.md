# swimnerd-templates

A streaming overlay system for competitive swimming meets. Displays real-time race data (event info, lane results, running timer) through themed HTML overlays designed for use with OBS or similar broadcast software.

## Live Pages

- [Full Simulator Test Output](https://lgbeno.github.io/swimnerd-templates/Simulator.html)
- [Title Header Template](https://lgbeno.github.io/swimnerd-templates/themes/default/HeaderOverlay.html)
- [Lane Text Template](https://lgbeno.github.io/swimnerd-templates/themes/default/LaneOverlay.html)
- [Timer Template](https://lgbeno.github.io/swimnerd-templates/themes/default/TimerOverlay.html)
- [Data Logger](https://lgbeno.github.io/swimnerd-templates/DataLogger.html)
- [CTS6 Serial Decoder](CTS6.html) — capture replay, Meet Manager roster matching, and read-only Web Serial input.
- [Serial Bridge](SerialBridge.html) — two live serial ports in (timing console and Meet Manager), overlay feed out.

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
- **Spooky** (`themes/spooky/`) -- Spooky Splash Spectacular: moonlit coffin banner, carved pumpkin lane markers, floating ghosts, podium accents, and a zombie race clock. [Open the interactive preview](themes/spooky/Preview.html), then run a 20-second demo through lineup, splits, and final results. Graphics use local SVG/CSS and system fonts, with reduced-motion support; OBS backgrounds remain transparent.

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
├── SerialBridge.html            # Live serial ports to overlay feed
├── CTS6.html                    # Capture replay and decoder lab
├── js/                          # Shared overlay logic
│   ├── overlay-core.js
│   ├── lane-overlay.js
│   ├── timer-overlay.js
│   ├── header-overlay.js
│   ├── LogCompressor.js
│   ├── test_log_compressor.js
│   ├── cts6/                    # Timing console decoder
│   └── bridge/                  # Meet Manager decoder, relay and OBS links, bridge page logic
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

### Full-screen Spooky effects for OBS

Add `themes/spooky/EffectsOverlay.html` as a separate **Browser Source**, sized to your canvas (for example, **1920 × 1080**), above the camera. Place your scoreboard sources above it to keep race information in front of the characters. The source has a transparent background and no controls or audio.

The cast includes 15 cameos: ghosts, Frankenstein, a spider web, bats, a witch, tumbling pumpkins, a mummy, a black cat, a cauldron, a dancing skeleton, swimming ghosts, autumn leaves, candy, peeking monsters, and a pumpkin portal. Each lasts up to 10 seconds. A shuffled bag plays every cameo once before repeating and avoids an immediate repeat between rounds. The OBS source listens to the same BroadcastChannel/WebSocket scoreboard feed as the other overlays. Its first event establishes a baseline; only a later event-number change can start a cameo. State 3 (timer running), unknown state, hidden sources, and reduced-motion preferences block new animations. An animation already playing finishes naturally when the timer starts. Blocked event changes are discarded, never queued for the finish. Heat changes, repeated data, and visibility changes do not start animations.

In the [Spooky preview](themes/spooky/Preview.html), **Next event** changes the event number and triggers one cameo. Heat changes and race finishes do not trigger effects. Starting a heat or race disables new auditions but lets an existing cameo finish. During the new-event introduction, the selector and **Play selected** button can audition any of the 15 cameos. Auditions do not consume the shuffled event rotation. The preview uses the same event/timer interlock as the live source. Use `?preview=1` (or legacy `?autoplay=0`) only when a parent page supplies scoreboard data through `SpookyEffects.processData`.

## CTS6 serial decoder

Open [CTS6.html](CTS6.html) through a local HTTP server to replay a CTS6 capture or connect a legacy scoreboard serial feed. Import an extracted meet folder containing `CTS6_Capture.csv` and Meet Manager `.scb` files. The page provides playback, seeking, lane/time inspection, raw channels, JSON download, and optional publishing to the existing overlays. Video features are not included.

Live Web Serial requires desktop Chrome/Edge and localhost or HTTPS. Finish classification and reset-state inference are experimental and disabled in overlay output by default; actual CTS6 hardware remains to be validated. See [decoder documentation](js/cts6/README.md) for supported fields, settings, limitations, and tests.

## Serial bridge

[SerialBridge.html](SerialBridge.html) reads the two things a meet needs and feeds the overlays. Each has a box with a Connect button:

| Box | Reads | Provides |
| --- | --- | --- |
| Timer | the CTS6 scoreboard output of the timing console | running clock, lane times and places, event and heat numbers |
| Event data | the Meet Manager generic scoreboard link | event title, swimmer or relay names, teams |

The page knows the settings each link uses (9600 8E1 for the console, 9600 8N1 for Meet Manager), so connecting is one click. **Port settings…** opens a dialog for the rare console or link set up differently; the status line then says what the port is set to. **Load** reads Meet Manager start-list files (`.scb`, one per event; select them all at once), and each file replaces its whole event. **Save** writes every stored event back out as `E001.scb`, `E002.scb`… into a folder you pick, in Meet Manager's own layout. Start lists from files and from Meet Manager are kept in the browser until **Clear** is pressed, so clear them before a new meet. The page only listens on both ports.

Each box shows what its link delivers: the Timer box has the event and heat, the console clock and each lane's place and time; the Event data box shows one start list lane by lane and how many events and heats are stored. It follows each start list as it arrives; the − and + buttons step through the stored events and the heats of each, the numbers can be typed, and **Show latest** goes back to following. Overlay tabs in the same browser receive the feed on the `swimnerd-scoreboard` BroadcastChannel whenever the timer is connected. Capture replay, the WebSocket relay and the OBS link are not on this page yet; they are being added back one block at a time.

### Running it

Web Serial needs desktop Chrome or Edge and a page served from localhost or HTTPS:

```bash
python3 -m http.server 8873
```

Open `http://localhost:8873/SerialBridge.html`, press **Connect** in each box and pick its port.

### Trying it without hardware

Open `http://localhost:8873/SerialBridge.html?simulate=1`, or follow **Run with simulated ports** at the foot of the page. Both Connect buttons then open a made-up meet that repeats; a banner marks the page as simulated and its start lists are kept apart from real ones. The bytes come from `js/bridge/simulator.js`, which is written from this project's own reading of the two protocols: it shows that the page works, not that the reading is right.

```bash
node js/test_serial_simulator.js
```

### Status

The decoders are tested against real captures of both links, and the page has read a live Meet Manager link. See [Meet Manager link findings](docs/GENSER-Serial-Protocol-Findings.md) for what the start-list decoding does and does not cover.

```bash
node js/test_genser.js
```
