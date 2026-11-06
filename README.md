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

[SerialBridge.html](SerialBridge.html) takes the two things a meet needs and publishes the overlay feed live. Each has its own box on the page:

| Box | Source | Settings | Provides |
| --- | --- | --- | --- |
| Timer stream | CTS6 scoreboard output, over serial | 9600 baud, 8 data, even parity, 1 stop | running clock, lane times and places, event and heat numbers |
| Event data | files, or the Meet Manager generic scoreboard link over serial | 9600 baud, 8 data, no parity, 1 stop | event title, swimmer or relay names, teams |

It reuses the CTS6 decoder and produces the same JSON as the simulator, so the existing overlays need no changes to display it.

### Running it

Web Serial needs desktop Chrome or Edge and a page served from localhost or HTTPS:

```bash
python3 -m http.server 8873
```

Open `http://localhost:8873/SerialBridge.html`, connect the timer port, give the page its event data, check the scoreboard preview, then tick **Publish to overlays**.

Event data can come from files, from serial, or from both. **Choose files** accepts Meet Manager start-list files (`.scb`, one per event) and captures of the scoreboard link: a `com-monitor` log or the raw bytes. **Choose folder** reads every `.scb` file in a folder. An `.scb` file replaces its whole event, a start list from a capture or from serial replaces one heat, and everything is saved in the browser until **Clear saved event data** is pressed, so clear it before loading a new meet.

The Meet Manager port only listens by default. It collects start lists as the scoreboard computer requests them from Meet Manager and saves them in the browser, so they survive a reload. Tick **Ask Meet Manager for the current heat** only when the adapter is wired in place of the scoreboard computer. In that mode the page transmits requests, which must never happen on a tapped live link.

### Getting the feed into OBS

A web page can open WebSocket connections but cannot accept them, so the bridge cannot be a WebSocket server by itself. Something else has to sit between the page and an OBS Browser Source. Three outputs are available, and they can be used together:

| Output | Reaches | Needs |
| --- | --- | --- |
| BroadcastChannel | overlay tabs in the same browser profile | nothing |
| WebSocket relay | any machine that can reach the relay | `websocket-test-server` running; overlays connect to `ws://localhost:8080/`, so run it on the OBS machine |
| OBS directly | every Browser Source in that OBS | OBS 28 or newer, with **Tools → WebSocket Server Settings → Enable WebSocket server** |

The direct route uses the WebSocket server built into OBS. The bridge logs in and sends each update with the obs-browser `emit_event` request, and OBS hands it to every Browser Source as a `swimnerd-scoreboard` window event, which `js/overlay-core.js` listens for. No relay process is needed. Enter the OBS machine's address, for example `ws://192.168.1.20:4455/`, and the password shown in the OBS settings dialog.

Serve the page from localhost when OBS is on another machine. A page loaded over HTTPS, such as the GitHub Pages copy, may only open `ws://` connections to localhost.

### Health readout

The page shows how many clock updates arrive per second, the longest gap between them, and how many tenths were missing. The console sends the clock ten times a second, so a healthy feed reads about 10 per second with gaps near 100 ms. Serial read errors are counted per port. A wrong parity setting shows up as bytes arriving while nothing decodes.

### Trying it without hardware

Open `http://localhost:8873/SerialBridge.html?simulate=1`, or follow **Run with simulated ports** at the foot of the page. Both connect buttons then open a made-up device in place of a real port: a timing console running a five-heat meet on a loop of about five minutes, and Meet Manager sending the start lists for it. Each heat sits at 0:00.0 for 8 seconds, runs with a split and a finish per lane, then holds the results for 8 seconds. Ticking **Ask Meet Manager for the current heat** makes the simulated Meet Manager answer the page's own requests. `CTS6.html?simulate=1` offers the timer port alone.

Everything downstream of the port is the real page: decoding, the health readout, publishing to overlays, the relay and OBS. A banner marks the page as simulated, and simulated start lists are saved apart from real ones. All names are invented.

The bytes come from `js/bridge/simulator.js`, which is written from this project's own reading of the two protocols. It shows that the page works, not that the reading is right. Splits are sent without a place, format data carries only the reset dot, and wrong baud or parity settings have no effect.

```bash
node js/test_serial_simulator.js
```

### Status

The decoders are tested against real captures of both links. The page is tested in a browser with mocked serial ports, the relay, and a stand-in for the OBS WebSocket server written from the protocol documentation. It has not yet been run against the physical ports or a real OBS instance. See [Meet Manager link findings](docs/GENSER-Serial-Protocol-Findings.md) for what the start-list decoding does and does not cover.

```bash
node js/test_genser.js
```
