# CTS6 serial decoder lab

See [Protocol findings and decoding confidence](../../docs/CTS6-Serial-Protocol-Findings.md) for the evidence, field mappings, uncertainties, and validation plan.

Open `/CTS6.html` from the repository HTTP server (for example `http://127.0.0.1:8873/CTS6.html`). No build or JavaScript packages are required by the page. Video processing is out of scope.

## Replay a capture

1. Unzip the meet archive locally. Choose the extracted folder, or select the CSV and `.scb` files together.
2. Press **Play**. Pause, change speed, restart, or scrub through the capture. Scrubbing reconstructs state without broadcasting intermediate events.
3. Inspect the lane display, raw channels, and generated JSON. A missing roster does not borrow names from another event or heat.
4. To test overlays, stop the simulator, open the desired theme's overlay pages on the same origin/browser profile, then enable **Publish to browser overlays** while playing. Pausing, seeking, restarting, changing input, and reaching the end turn publishing off. There is no automatic loop.
5. OBS and other browser profiles require the existing WebSocket relay; BroadcastChannel cannot cross those boundaries. Connect the relay explicitly, then enable publishing. The decoder only sends messages; it does not consume relayed data.

The imported files remain in browser memory. Explicit publishing sends names/timing data to the chosen local channel/relay; JSON download saves the current normalized state. Captures and rosters are not bundled into the repository. Importing a new CSV clears the old roster set; importing only SCB files adds/replaces those events. Reloading files is currently manual.

## Live serial

Use desktop Chrome/Edge on localhost or HTTPS. Select **Connect serial**, choose the adapter, and verify the settings against the console. The initial setting is 9600 baud, 8 data bits, even parity, one stop bit (legacy FAST scoreboard mode); baud and parity are configurable. This is the **legacy scoreboard feed**, not the meet-management results port and not Gen7 enhanced serial. Use the appropriate electrical adapter/cable for the specific output. The page only reads; it never sends commands or opens a writer.

Live input and replay share the decoder. Connection loss marks timing state unknown and turns publishing off. Partial blocks remain buffered across serial reads. Reconnection starts a new decoder state. Actual CTS6 hardware connection remains untested; browser tests use a mock serial port.

## Protocol interpretation

Protocol mapping is informed by [coloradoScoreboard](https://github.com/fabriziobertocci/coloradoScoreboard), with its MIT notice in `THIRD_PARTY_NOTICES.md`. This is an independent browser implementation with separate raw parsing, replay, roster import, and payload adaptation.

- Bytes with bit 7 set begin a control block. Channel = `((control >> 1) & 31) ^ 31`.
- Bit 0 distinguishes readout (0) from format (1). Bit 6 selects universal running-clock display for that module.
- Data bytes encode digit position in the high nibble and complemented digit in the low nibble. Low nibble 0 is blank; 6–15 represent 9–0. Other glyph values are not guessed as numeric times.
- A block commits at the next control byte. Only an explicit end-of-file flush commits the final block; serial read boundaries do not delimit blocks.
- Channel 0 digits 2–6 are the running clock, `MMSSd`. Lane channels 1–10 contain lane, place, and `MMSSdd`. Universal lane displays are not emitted as individual split times.
- Channel 12 digits 0–2 and 5–7 contain event and heat. Event/heat changes invalidate previous lane results until those channels refresh.
- Meet Manager SCB header: `#event title`; subsequent rows are name/relay and team separated by `--`. Preserve every blank lane. This importer assumes ten slots per heat, starting at lane 1, in file order. File text is decoded as Windows-1252; truncated names cannot be reconstructed.

## State and result limitations

Clock advancement produces running state (overlay state 3). A stale feed or clock does **not** imply idle; it becomes unknown (`null` in overlay JSON). There is no finish inference based on silence.

A fresh zero clock plus lane format nibble 13 at position 0 is shown as **RESET · INFERRED**. This matches reset-like periods in the supplied capture, but needs hardware/video validation. By default it remains unknown in exported JSON so spooky animations cannot start. The explicit **allow reset-dot inference** option maps it to overlay state 2. This is an experimental setting, not a guarantee that the console is idle.

Displayed lane place and time are shown directly for inspection. They are not automatically classified as official finishes: scoreboard split/rank displays can be ambiguous. Default JSON puts the displayed time in `SplitTime` and leaves `FinalTime` and `Place` empty. An explicit experimental option treats placed times as finals. Validate that behavior against video or matching Swimnerd JSON before use. DQ/status glyphs, lane 0 layouts, time-of-day, lengths, and special scoreboard modes are not yet normalized.

## Validation

Run the synthetic tests without private meet data:

```sh
node js/test_cts6.js
```

To also validate the supplied weekend dataset, pass an extracted folder with the CSV and SCB files directly inside it:

```sh
node js/test_cts6.js /path/to/extracted/spooky_sun
```

The optional regression expects 1,823 RX chunks, 556,385 bytes, 637,477 ms, 75 roster files, event sequence 73–79, and a final event 79 / heat 1 clock of 2:12.8. These assertions verify decoding consistency, not independently certified race results. Events 74, 76, and 78 have no SCB files in that dataset.

Tests cover every split point of a synthetic byte stream, byte-at-a-time input, format isolation, universal clock lanes, event resets, stale clocks, optional state/finish mapping, blank SCB slots, multiple heats, malformed CSV, midnight rollover, and deterministic seeking. Next validation step: compare against the recording or Swimnerd JSON, then test a read-only live CTS6 connection.

An optional browser integration test uses a mock serial device (requires Playwright and its browser, plus the local HTTP server):

```sh
node js/test_cts6_browser.js
```

Set `CTS6_CHROME` to an existing Chrome executable when needed, or `CTS6_URL` to another local decoder URL. This checks read-only serial configuration, browser publishing, stale clocks, disconnect/reconnect, and device errors.
