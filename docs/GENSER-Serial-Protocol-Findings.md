# Meet Manager Generic Scoreboard (GENSER) Link: Findings

Prepared November 5, 2026 for the Swimnerd browser overlay project.

## Assessment

**I have high confidence in the request framing and the start-list record layout for the capture described here.** Every record in the capture decodes with one fixed layout, and each record's own event and heat fields equal the request that produced it. Confidence is low for anything the capture does not contain: results, scores, lanes 9 and 10, and any request type other than start lists.

This is a reconstruction from observed traffic. It is not HY-TEK's specification, which HY-TEK provides to scoreboard vendors on request.

## Evidence

One capture of a live link between HY-TEK Meet Manager and a scoreboard computer, taken with a serial monitor placed inline and forwarding both directions.

| Evidence | Observation |
| --- | --- |
| Serial settings | 9600 baud, 8 data bits, no parity, 1 stop bit |
| Duration | about 12 minutes |
| Requests from the scoreboard computer | 303, all 8 bytes |
| Replies from Meet Manager | 215 records of 502 bytes; 88 requests went unanswered |
| Distinct heats | 214, across 72 events numbered 1 to 88 |
| Bytes outside any record | 0 |
| Cross-check | every record's trailing event and heat equal its request |

The capture contains athlete names and is kept outside this repository.

## The conversation

The scoreboard computer asks for one heat at a time. Meet Manager answers with one record, or with silence when that heat does not exist.

The scoreboard computer walks the whole meet this way: heat 1, 2, 3 of an event until a request gets no answer, then the next event. Requests are about 0.67 s apart, and a reply begins about 16 ms after its request.

Three replies in the capture are not 502 bytes long. In each case a record for a different heat arrived while a request was outstanding. Reading Meet Manager's transmit stream by itself, all of those records are complete and correctly framed. This suggests the Meet Manager operator can also push a start list, in the same layout, at any time. A reader should therefore find records in the stream directly and not rely on pairing them with requests.

## Request, 8 bytes

```text
STX  E E E  H H  T  EOT
02   30 30 32  30 31  31  04      event 2, heat 1
```

| Bytes | Meaning |
| --- | --- |
| 0 | STX, 0x02 |
| 1-3 | event number, three ASCII digits, zero padded |
| 4-5 | heat number, two ASCII digits, zero padded |
| 6 | request type; `1` in every observed request |
| 7 | EOT, 0x04 |

## Reply, 502 bytes

Plain ASCII, fixed width, space padded. There is no checksum and no terminator. The next record simply begins with its own carriage return.

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 1 | carriage return, 0x0D |
| 1 | 1 | a digit that counts requests received, modulo 10 |
| 2 | 4 | `0120` in every record; meaning unknown |
| 6 | 2 | spaces |
| 8 | 28 | event name |
| 36 | 2 | spaces |
| 38 | 30 | round, for example `Timed Finals` |
| 68 | 1 | gender code: `G`, `B`, or `X` for mixed |
| 69 | 1 | space |
| 70 | 28 | abbreviated event name |
| 98 | 18 | spaces |
| 116 | 380 | ten lane slots of 38 characters, lanes 1 to 10 |
| 496 | 3 | event number, right aligned |
| 499 | 3 | heat number, right aligned |

Each lane slot:

| Offset in slot | Length | Meaning |
| --- | --- | --- |
| 0 | 1 | lane digit, or a space when the lane is empty |
| 1 | 20 | swimmer as `Last, First`, or the relay name; truncated to 20 |
| 21 | 4 | team code |
| 25 | 13 | blank in every observed record |

An illustrative record, shortened:

```text
<CR>20120  Boys 9-10 200 Medley Relay    Timed Finals   ...   B 9-10 200 MedleyR Timed Final ...
    3Relay-B             TEAM             4Relay-A             TEAM          ...           2  1
```

## Listening on one wire

Meet Manager's transmit line is sufficient to recover every start list, because each record names its own event and heat. Decoding that one direction of the capture yields all 214 heats with no stray bytes.

Two things are not visible from that wire alone:

- **Heats that do not exist.** Meet Manager answers those with silence.
- **Anything nobody asked for.** Meet Manager sends only when the scoreboard computer requests or the operator pushes. A listener that starts after the scoreboard computer has already walked the meet sees nothing until the next request.

The second point is why the serial bridge saves start lists in browser storage, and why it has an opt-in mode that sends requests itself.

## Confidence by capability

| Capability | Assessment | What would increase confidence |
| --- | --- | --- |
| Find and frame start-list records | High | Captures from another meet and another Meet Manager version |
| Event name, round, gender, lanes 1-8, teams | High for this capture | Comparison with the printed heat sheet |
| Request framing for start lists | High | A session where this project's own requests are answered |
| Lane 10 marker | Unknown | A ten-lane pool; the decoder accepts any marker in that slot |
| The 13 blank characters per lane | Unknown | A capture that includes results or seed times |
| The `0120` field | Unknown | Other record types |
| Results, team scores, other request types | Not observed | Captures of those operations |
| Pushed start lists | Inferred from three collisions | A capture with deliberate operator pushes |
| Text encoding beyond ASCII | Assumed Windows-1252 | Names with accented characters |

## Implementation

- [Decoder, request builder and start-list store](../js/bridge/genser.js)
- [Tests](../js/test_genser.js)
- [Serial bridge page](../SerialBridge.html)

```sh
node js/test_genser.js
node js/test_genser.js /path/to/capture.log PORT_NAME
```

The second form decodes a com-monitor log of the real link and prints counts only. `PORT_NAME` is the port that carried Meet Manager's transmit line.
