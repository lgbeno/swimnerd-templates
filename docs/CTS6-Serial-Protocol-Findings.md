# CTS6 Serial Protocol Findings and Decoding Confidence

Prepared October 26, 2026; updated November 4, 2026 for the Swimnerd browser overlay project.

## Assessment

**I have high confidence in the basic channel and numeric digit decoding for the supplied CTS6 capture. I have moderate confidence in the complete event, heat, and roster integration, and low confidence in automatic split versus finish classification and definitive idle detection.** The decoder is suitable for capture analysis and supervised comparison testing. It is not yet a validated replacement for the timing interpretation provided by Swimnerd during an unattended livestream.

The strongest result is that one consistent mapping explains the event sequence, running clock, and lane displays throughout the supplied recording. The main uncertainty is what those displays mean at particular moments in a race. Correctly reading “1:44.38” does not, by itself, establish that it is a final time.

These are qualitative engineering judgments, not measured accuracy percentages. A claim such as “99% accurate” would require independently labeled captures covering normal races and exceptional console operations. The current tests establish consistent decoding and software behavior; they do not establish an empirical error rate.

## Evidence and scope

The supplied `spooky_sun.zip` contains one serial capture and 75 Meet Manager scoreboard files. The findings apply to the **legacy CTS scoreboard output used in this recording**. They do not establish compatibility with the CTS meet-management results port, Gen7 enhanced protocol, every console configuration, or every sport.

| Evidence | Observation |
| --- | --- |
| Capture file | `CTS6_Capture.csv` |
| Recorded time window | 08:31:47.884 through 08:42:25.361; no date or timezone established by these time fields |
| Duration | 637,477 ms, or 10 minutes 37.477 seconds |
| Received chunks | 1,823 RX rows |
| Reconstructed serial data | 556,385 bytes |
| Byte count consistency | Every capture row's declared byte count matches its hex data |
| Scoreboard files | 75 `.scb` files |
| Decoded event sequence | 73, 74, 75, 76, 77, 78, 79 |
| Heat coverage | Heat 1 in the observed event sequence; live heat changes are not demonstrated by this capture |
| End of capture | Event 79, heat 1; running clock 2:12.8 |
| Example lane display at the end | Lane 4, displayed place 1, displayed time 1:44.38 |

The end-of-capture values are decoded observations, not independently verified official results. The archive does not contain a matching Swimnerd JSON recording or synchronized video against which to check them.

Protocol mapping was also informed by the MIT-licensed [coloradoScoreboard legacy implementation](https://github.com/fabriziobertocci/coloradoScoreboard/blob/fe1150851e3645dd9f8ed69c1705a27e7ef7cd16/src/coloradoScoreboard.js). This is useful independent implementation evidence, but it is not a manufacturer protocol specification. The local [attribution notice](../js/cts6/THIRD_PARTY_NOTICES.md) records that reference.

## What the stream represents

The stream behaves as updates to a numeric scoreboard display. It addresses channels and digit positions, with separate data for displayed values and formatting. The browser maintains that display state and interprets selected channels as swimming information.

This explains several important properties:

- Swimmer names and teams come from the Meet Manager files, not from the numeric channels decoded here.
- A received serial chunk can contain many channel updates or end partway through an update.
- A displayed time may be a running clock, an intermediate lane time, a recalled result, or a finish. Its role requires more context than its digits.
- Updates to different channels are not one atomic race-state packet. Event, clock, lane, and format information can arrive at different moments.

The code therefore separates byte decoding, display interpretation, roster matching, and overlay JSON generation. That separation lets us revise race semantics without replacing the byte parser.

## Control bytes and channel addressing

A byte with its most significant bit set, `byte & 0x80`, starts a control block. The current interpretation is:

```text
channel = ((control >> 1) & 0x1F) XOR 0x1F
bit 0 = 0: readout data
bit 0 = 1: format data
bit 6: universal running-clock display mode
```

The channel field addresses 32 channels, numbered 0–31. Universal mode is consistent with lane modules showing the common running clock instead of their own fixed time; its behavior across additional console modes remains to be checked.

| Control byte | Interpreted channel | Block type |
| --- | --- | --- |
| `BE` | 0 | Running-clock readout |
| `A6` | 12 | Event and heat readout |
| `A7` | 12 | Event and heat format |
| `B6` | 4 | Lane 4 readout |

The parser commits a block when the next control byte arrives. This is a buffering decision in our implementation, not a claim that the physical display waits for that byte. It prevents partially received blocks from being exposed at arbitrary USB or CSV chunk boundaries. At capture EOF, an explicit flush commits the last buffered block. A live connection does not flush merely because a read ends or pauses.

The capture begins partway through a block. Four leading bytes are skipped before the first control byte establishes a channel. This is expected when attaching to a stream already in progress.

## Data bytes and numeric encoding

Readout data bytes have their most significant bit clear. The upper nibble identifies a digit position, 0–7; the lower nibble encodes its value.

```text
position = byte >> 4
encoded value = byte & 0x0F
numeric digit = 15 - encoded value, for encoded values 6 through 15
```

| Low nibble | Interpretation |
| --- | --- |
| `0` | Blank |
| `6` through `F` | Digits 9 through 0 |
| `1` through `5` | Unresolved special glyphs; not treated as numeric time digits |

For example, `18` sets position 1 to digit 7, and `2C` sets position 2 to digit 3. Format bytes use the same position addressing, but their low nibble is retained separately rather than interpreted as a numeric digit.

An actual event block from the capture illustrates the mapping:

```text
A6 00 18 2C 30 40 50 60 7E
   p0 p1 p2 p3 p4 p5 p6 p7
    _  7  3  _  _  _  _  1
```

With event digits at positions 0–2 and heat digits at positions 5–7, this reads **event 73, heat 1**. Underscores above represent blank digits.

## Swimming field mapping

Positions in this table are zero-based.

| Channel | Positions | Current interpretation | Confidence |
| --- | --- | --- | --- |
| 0 | 2–6 | Running time `MMSSd`, with tenths | High for this capture |
| 1–10 | 0 | Displayed lane digit | High for ordinary single-digit lanes; lane 10 encoding unresolved |
| 1–10 | 1 | Displayed place digit | High for ordinary digits; meaning as final rank is unverified |
| 1–10 | 2–7 | Lane time `MMSSdd`, with hundredths | High for numeric display reconstruction |
| 12 | 0–2 | Event number | High for the observed events |
| 12 | 5–7 | Heat number | Moderate; reference-supported, but real capture stays at heat 1 |
| Other channels | Various | Retained in the raw inspector | Not normalized or semantically validated |

One recorded clock block is:

```text
BE 70 67 5D 4E 30 20
```

Its digit updates arrive in descending position order. Positions 2–6 reconstruct as blank, blank, 1, 2, 8, giving **0:12.8**. The parser uses explicit positions, so it does not require ascending digit order.

The display mapping also explains the final lane 4 digits as lane 4, place 1, and **1:44.38**. The decoder deliberately labels this a displayed time rather than asserting a confirmed finish.

## Meet Manager roster matching

Each supplied `.scb` file begins with a header such as `#73 MIXED 8&U 100 FREE RELAY`. Subsequent lines contain a swimmer or relay label and a team, separated by `--`. All 75 files have a number of roster lines divisible by ten.

The current importer preserves blank rows and groups ten consecutive rows into a heat. It assumes the first row represents lane 1, then lane 2, through lane 10. Matching uses decoded event number, decoded heat number, and lane position. Files are read as Windows-1252 text. Truncated names remain truncated; the importer cannot reconstruct the missing text.

**Confidence is high in parsing these files and moderate in the complete lane/heat assignment.** Ten-slot grouping is strongly supported by the archive, but lane numbering and heat ordering need comparison with the actual meet lineup. Synthetic tests cover multiple heats; they do not replace a real captured heat transition.

Events 74, 76, and 78 appear briefly in the serial capture but have no corresponding SCB files in the archive. They may reflect operator navigation, but the capture alone cannot establish the reason. The application shows a missing roster rather than assigning names from a neighboring event. It does not currently suppress these intermediate event selections through a stability delay.

## Timer state and animation interlock

The decoded clock supports evidence of activity, but the protocol interpretation does not yet provide a verified explicit “timer running” flag.

| Condition | Current behavior | Confidence and limitation |
| --- | --- | --- |
| Successive valid clock values increase | Report running; overlay state 3 | Moderate to high for ordinary racing; not proof against recalled or manually changed display values |
| First clock observation | Keep state unknown until more evidence arrives | Intentional conservative behavior |
| Clock decreases or becomes invalid | Report unknown | Reset, correction, and recalled data are not distinguished |
| No clock update or advancement for over 1,500 ms | Report unknown | Timeout is an application threshold, not a CTS protocol constant |
| Zero clock followed within 500 ms by lane format position 0 containing nibble `D` | Display “RESET · INFERRED” | Low to moderate; observed pattern, not independently verified reset signaling |

A stationary clock or a disconnected feed is never sufficient evidence of idle. Reset inference maps to overlay state 2 only when its experimental option is enabled. Otherwise both inferred reset and unknown states export `null`, which the current spooky effect interlock rejects.

The 500 ms reset window and 1,500 ms stale threshold are tunable choices. CSV timestamps describe received chunks, not the exact transmission time of every byte. Live USB batching, scheduling delays, and browser throttling may affect those thresholds. Reset inference needs particular attention before it can safely trigger event animations automatically.

## Splits and finishes

**Confidence in automatic finish classification is low.** The current parser can reconstruct displayed time and place digits, but it has not established a reliable protocol-level distinction between an intermediate split, its rank, and a final result.

By default, the adapter places a fixed lane time in `SplitTime` and leaves `FinalTime` and `Place` empty. This is a compatibility choice to avoid presenting an unverified finish; it does not certify that every exported time is a split. An experimental option treats a placed time as a finish. That option can misclassify a ranked split and should remain off until validated.

Distance, length count, relay exchanges, touchpad corrections, recall operations, and DQ/status displays are not yet part of the normalized race interpretation. Displayed place also must not be assumed to equal the official Meet Manager result.

## Confidence by capability

“High” means the observed mapping is consistent with the supplied data and the reference implementation. “Moderate” means the explanation is plausible and implemented but has limited real-world coverage. “Low” means an important semantic rule is still a hypothesis. “Untested” means the environment or behavior has not been exercised directly.

| Capability | Assessment | What would increase confidence |
| --- | --- | --- |
| Recover bytes from this CSV | High | Additional capture/export formats |
| Maintain parser state across read boundaries | High | Recorded noisy or interrupted connections |
| Decode ordinary event, clock, and lane-time digits | High within observed mode | Synchronized comparison with the console or video |
| Decode changing heat numbers | Moderate | Real captures with multiple heat transitions and multi-digit heats |
| Match the SCB roster to the correct lane | Moderate | Compare every active lane with the meet lineup across several heats |
| Interpret universal clock mode | Moderate | Verify transitions from shared clock to splits and results |
| Detect active racing from clock movement | Moderate | Starts, recalls, manual edits, and scoreboard-mode changes |
| Identify reset or idle definitively | Low to moderate | Controlled reset/start sequences with independent labels |
| Distinguish split from final automatically | Low | Labeled split and finish sequences across several distances |
| Open and read a real CTS6 connection in the browser | Untested on hardware | Read-only session using the actual adapter and console |
| Handle corruption, unusual glyphs, and alternate modes | Low or unsupported | Fault injection and captures of those modes |
| Replace Swimnerd interpretation unattended | Not yet established | All critical timing and semantic checks below |

The initial live serial configuration is 9600 baud, eight data bits, even parity, and one stop bit, informed by the legacy implementation. The byte capture does not establish the physical cable, electrical interface, or actual console serial settings. Those must be checked at the venue.

## What the tests prove

The current automated suite passes ten test groups when run with the supplied weekend dataset. It covers channel and digit mapping, every two-part split of a synthetic stream, byte-at-a-time delivery, format isolation, universal clock handling, event/heat invalidation, state inference, SCB blank slots, CSV validation, midnight rollover, and deterministic replay.

The real-capture regression checks all 1,823 chunks and all 75 roster files, plus the event sequence and selected final display values. Expected decoded values were established from this analysis, so these are regression checks rather than an independent accuracy benchmark. Agreement with our own expected output must not be mistaken for confirmation by the timing console.

Browser checks also exercised file import, playback controls, seeking, mobile layout, and publishing. A mocked Web Serial device exercised serial settings, reads, stale clocks, disconnect, fresh reconnect, and device errors. This demonstrates browser code behavior under simulated conditions; it does not verify USB hardware, electrical compatibility, driver behavior, or long-session reliability.

The legacy parser does not currently validate a wire-level checksum. Matching a CSV row's byte count proves that its hex was imported consistently, not that the physical transmission was error-free. A corrupted byte could still resemble a legitimate control or numeric update. Event/heat changes invalidate cached lane results, but stale or recalled data within the same event and heat require further semantic validation.

## Validation required before live replacement

1. **Compare one recording end to end.** Align this capture with its stream video or Swimnerd JSON. Check event, heat, running time, each active lane's identity, displayed place, and displayed time. Record every mismatch and its timestamp. Allow for measured display latency rather than demanding identical arrival times.
2. **Capture controlled console operations.** Label reset, start, first split, later splits, individual finishes, last finish, stop, recall, and next heat/event. Include a ranked split and a same-heat restart so that digit decoding cannot conceal semantic mistakes.
3. **Expand coverage.** Exercise short and long races, relays, missing swimmers, empty lanes, a DQ, corrected times, multi-digit event/heat numbers, and the venue's lane numbering. Confirm the correct physical port and adapter.
4. **Run beside the existing system.** Compare the read-only browser feed during a full session while the established broadcast setup remains authoritative. Any parallel connection must use an appropriate supported signal path, not an assumed passive serial split.
5. **Validate the animation rule separately.** A running or unknown timer must never authorize a new effect. A confirmed new event while idle may authorize one. Heat changes, stalled data, and reconnects must not create false event starts; an effect already playing should finish normally.

The readiness target is no unexplained mismatches in the labeled validation set, correct handling of every exercised split/finish transition, and no false idle authorizations during running or unknown periods. That would support deployment for the tested console configuration while leaving unsupported modes explicitly identified.

## Implementation references

- [Decoder and normalized output](../js/cts6/decoder.js)
- [Browser serial and replay controls](../js/cts6/app.js)
- [Decoder tests](../js/test_cts6.js)
- [Mock serial browser test](../js/test_cts6_browser.js)
- [Usage and configuration](../js/cts6/README.md)
- [Decoder page](../CTS6.html)

To repeat the checks from the repository root:

```sh
node js/test_cts6.js
node js/test_cts6.js /path/to/extracted/spooky_sun
```

The second command expects the CSV and SCB files directly in that directory. Keep the private meet files outside the repository.

## Clock jitter investigation

Analysis of the supplied capture found 6,378 complete clock blocks, each containing six digit updates in position order 7, 6, 5, 4, 3, 2. Of the 6,377 consecutive clock transitions, 5,971 advanced exactly 0.1 second, 402 repeated, and four moved backward around reset sequences. No consecutive decoded clock values jumped forward by more than 0.1 second.

The recorded arrival cadence was much less regular:

| Measurement | Value |
| --- | --- |
| Mean clock updates per CSV chunk | 3.50 |
| Median clock updates per chunk | 3 |
| Maximum clock updates per chunk | 7 |
| Median gap between CSV chunks | 307 ms |
| Mean gap between CSV chunks | 349.88 ms |
| 90th percentile chunk gap | 640 ms |
| Maximum chunk gap | 745 ms |

The four backward transitions were 1:46.8 to 0:00.0, 3:35.3 to 0:00.0, 2:35.0 to 0:05.1, and 0:05.1 to 0:00.0. The intermediate 0:05.1 is a decoded observation during a reset-like sequence, not proof of a new race.

There is high confidence that the recording batches multiple clock updates. There is moderate confidence that similar batching caused the reported livestream jitter. The recording cannot distinguish buffering in the driver, serial reader, or capture logger, and does not contain the corresponding Swimnerd JSON arrival times.

The current timer overlay directly assigns each incoming `RunningTime` to its text element. It has no visual clock interpolation. Displaying only the newest clock in each batch can therefore show 13.0 followed by 13.6, even though every intermediate tenth exists in the serial stream. The current capture replayer also preserves chunk timing and can reproduce that effect.

A second possible source of flicker is publishing incomplete digit updates. Since tenths arrive before seconds, a byte-by-byte display could briefly show 13.0 between 13.9 and 14.0. Our decoder commits complete blocks. The capture does not establish how Swimnerd handles that boundary.

A proposed improvement, not yet implemented, is to keep authoritative received times separate from a visual clock. While running is confirmed, advance the visual clock between updates and gently correct its offset. Freeze on stale input and handle reset explicitly. Never interpolate recorded split or finish results. Compare synchronized video and Swimnerd JSON before attributing the venue issue to a particular component.

## Integration boundaries and serial settings

**The existing Meet Manager ↔ CTS6 timing-console connection must remain unchanged.** Event-sequence download and official result retrieval stay with that system. Our application consumes the separate CTS scoreboard output and may eventually use Meet Manager's scoreboard interface for live roster updates. Video integration is deferred.

| Connection | Rate and framing | Evidence and status |
| --- | --- | --- |
| CTS6 scoreboard output to decoder | FAST 9600 baud, 8-E-1; SLOW 2400 baud, 8-E-1 | Documented by the legacy decoder reference; our initial setting is FAST |
| Meet Manager to CTS6 physical COM1 | 9600 baud, 8-O-1 reported | Working third-party integration report, not verified against this venue; retain the existing working configuration |
| Meet Manager scoreboard interface to browser or scoreboard PC | Configurable baud, parity, data bits, and stop bits | Both endpoints must match the actual GENSER configuration |

Here E means even parity and O means odd parity; both formats use eight data bits and one stop bit. The scoreboard feed's even parity must not be assumed to apply to the separate timer-management connection. Windows COM numbers identify adapters, not rates. CTS6 physical COM1 identifies the timer-management socket.

Sources: [legacy scoreboard rates](https://github.com/fabriziobertocci/coloradoScoreboard#protocol), [firsthand timer-link report](https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-wireless-serial-connection-to-meet-computer/), [CTS physical connection guide](https://coloradotime.com/support/connecting-a-meet-management-computer-to-a-cts-timing-console), and [HY-TEK GENSER port configuration](https://activenetwork.my.salesforce-sites.com/hytekswimming/articles/en_US/Article/New-Configuring-Scoreboard-Port-for-Generic-Scoreboard).

GENSER is a separate Alpha Scoreboard interface carrying start lists, results, and team scores. HY-TEK documents serial and supported UDP configurations and offers protocol details to scoreboard vendors. Exact request/response framing for automatic event/heat lookup has not yet been implemented in this project. The user's CTS capture is insufficient to reconstruct that separate conversation. See [HY-TEK scoreboard interfaces](https://hytek.active.com/user_guides_html/swmm7/scoreboardinterface.htm).

The referenced open-source projects primarily read numeric scoreboard output. `STU940652/CTS_Scoreboard` also contains a [Hy-Tek event loader](https://github.com/STU940652/CTS_Scoreboard/blob/master/hytek_event_loader.py), but inspection shows it parses CSV files and indexes event/heat/lane entries; it is not a live Meet Manager serial client. `hwbrill/vsCTS` documents interception and numeric display interpretation. These are useful references, not a complete implementation of GENSER or the timer-management protocol.

Sending compatible data to a DisplayLink+ PC is a possible later extension, distinct from sending commands to the timing console. CTS documents separate timer and Meet Manager inputs to the scoreboard PC. Our JSON is not automatically a compatible serial output. Implementing this would require identifying the receiving application, obtaining its expected protocol, and testing both request and response directions. See [CTS DisplayLink+ connection guide](https://coloradotime.com/support/connecting-meet-management-to-system-6-and-dl-computer).

One further reference lead is [vsCTS's lane mapping](https://github.com/hwbrill/vsCTS): it describes low nibble 5 as lane/place 10. Our current generic digit converter only accepts numeric digits 0–9, so lane/place 10 handling remains a known limitation pending a suitable capture and a position-specific implementation.

Repeat the clock-cadence analysis with `node js/analyze_cts6_clock.js /path/to/CTS6_Capture.csv`. The report includes clock steps, chunk spacing, and reset observations without roster names.
