# Ashwaubenon Jaguars — 2026 Sectionals

Forest green, gold, dark opaque score panels, large tabular finish times, and school-colored team labels. Short entrance/exit transitions only; no full-screen effects, ambient animations, or timers that start decorative effects. Existing shared timing logic remains unchanged.

## OBS setup

Serve the repository locally (for example `python3 -m http.server 8873 --bind 127.0.0.1`). Add one Browser Source:

- URL: `http://127.0.0.1:8873/themes/jaguars/BroadcastOverlay.html`
- Width: **1920**, height: **1080**
- Put it above the camera source. The background is transparent.
- Connect the existing scoreboard WebSocket feed at `ws://localhost:8080/`. Same-origin BroadcastChannel input is also supported, as in the other themes.

The composite places the header across the top, timer at top right, and eight lane rows at bottom right. It scales uniformly for other 16:9 source sizes. For custom OBS layouts, use the individual HeaderOverlay (1920×148), TimerOverlay (310×78), and LaneOverlay (760×640) pages instead; the header starts 12px inside its source. Do not add individual overlays and the composite simultaneously.

`Preview.html` provides the pool-camera composition, a 15-second race demonstration, a background switch, and a Next teams button covering all 13 programs. Swimmer names and times are fictional; the race clock is accelerated. Preview frames receive data directly from their parent and never open WebSockets or BroadcastChannels. Do not use the preview page as a live OBS source. The pool photograph is reused from the existing spooky preview, cropped only in CSS to exclude baked-in graphics.

The theme is also available in the main Simulator dropdown. The shared simulator's built-in sample teams may not match this sectional; use the dedicated preview to see school palettes.

## Verified field and identity

Research checked November 4, 2026:

- [WIAA 2026 Division 2 assignments](https://www.wiaawi.org/Portals/0/PDF/Sports/SwimmingDiving/Fall%202026/2026%20D2%20Girls%20Swim%20%26%20Dive%20Assignments.pdf): Sectional 2 has the 13 programs below. Diving November 6; swimming November 7. This early assignment document still labels the host TBD.
- [WIAA tournament page](https://www.wiaawi.org/sports/girls-swim-dive/girls-swim-dive-tournament): identifies the Ashwaubenon sectional and links its psych sheet, updated November 4.
- [Ashwaubenon 2026 psych sheet](https://www.wiaawi.org/sites/default/files/pdfs/PDF/Sports/SwimmingDiving/Fall%202026/GSectional%2726/ashwaubenon02.htm): confirms swimming entries from all 13 programs and shortened school labels. This is an entry list, not final attendance or official results. No start times or individual athlete entries are embedded in this theme.

School colors and lead-school mascot names below are from the linked WIAA school directory entries. Hex values are **design approximations for broadcast**, not claimed official brand standards. Co-ops use the lead school's palette and mascot in the preview directory; this does not claim that every partner uses that mascot. The stream displays the full co-op name. The overlay uses typography and school colors without a school or WIAA logo.

| Program | Lead-school identity | Color family |
|---|---|---|
| [Ashwaubenon](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=20) | Jaguars | Forest green / gold |
| [Antigo](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=11) | Red Robins | Maroon / white |
| [Clintonville](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=77) | Truckers | Burnt orange / black |
| [Marinette/Peshtigo](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=229) | Marines | Purple / white |
| [New London](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=294) | Bulldogs | Red / white |
| [Notre Dame/Green Bay N.E.W. Lutheran](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=306) | Tritons | Royal blue / kelly green / white |
| [Pulaski](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=352) | Red Raiders | Scarlet red / white |
| [Shawano/Bonduel](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=388) | Hawks | Red / white / black |
| [Seymour/Freedom](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=387) | Thunder | Red / white |
| [Sturgeon Bay/Sevastopol/Southern Door](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=416) | Clippers | Red / white |
| [Two Rivers/Roncalli](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=432) | Purple Raiders | Purple / gold |
| [Wausau East](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=454) | Lumberjacks | Red / white |
| [Wittenberg-Birnamwood](https://schools.wiaawi.org/Directory/School/GetDirectorySchool?orgID=491) | Chargers | Green / gold |

## Team matching and maintenance

`teams.js` contains all 13 programs, palettes, source school IDs, and exact aliases. Matching ignores case, whitespace, and punctuation, but deliberately avoids substring/fuzzy matching. Verified psych-sheet variants include `Marinette/Peshti`, `Notre Dame/N.E.W`, `Sturgeon Bay Co-op`, `Two Rivers/Ronc`, and `Witt-Birn`.

The actual live Meet Manager export may use short codes not present in the psych sheet. Add those verified codes to `codeAliases` in `teams.js` before the meet. Unknown teams retain their incoming label with a neutral palette; they are never guessed. No Meet Manager roster or serial decoder changes are needed.

Team color is an accent, not a replacement for legible white swimmer names/times. Place medals retain gold/silver/bronze cues. Full co-op names are expanded in labels; exceptionally long incoming text is safely clipped rather than allowed to cover finish times.

## Validation

Run `node js/test_jaguars.js` for roster/alias checks. Browser checks are in `js/test_jaguars_browser.js` and require Playwright, Chrome, and the local server on port 8873. They cover isolated demo inputs, all school labels, race lineup clearing, finished results, reset, and transparent live composition. Live meet feed codes and physical OBS integration still need an operator check before broadcast.
