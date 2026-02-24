# Theme Specification

This document explains how to create a new theme for the ACS Swim Scoreboard overlay system.

---

## Architecture Overview

Each overlay page is a self-contained HTML file inside a theme directory:

```
js/
  overlay-core.js           # WebSocket, BroadcastChannel, shared utilities
  lane-overlay.js           # Lane state management + processLaneData()
  timer-overlay.js          # Timer state management + processTimerData()
  header-overlay.js         # Header state management + processHeaderData()
css/
  lane-structure.css        # Lane layout/positioning (shared across all themes)
  timer-structure.css       # Timer layout/positioning
  header-structure.css      # Header layout/positioning
themes/
  default/
    LaneOverlay.html
    TimerOverlay.html
    HeaderOverlay.html
  mario/
    LaneOverlay.html
    TimerOverlay.html
    HeaderOverlay.html
  THEME_SPEC.md             # This file
```

The shared `js/` files contain all scoreboard logic (WebSocket, data processing, state machines). The shared `css/` files contain structural layout (positioning, sizing, flex). Each theme HTML file contains only:

1. A `<link>` to the structural CSS
2. An inline `<style>` with all visual CSS (colors, fonts, borders, shadows, animations)
3. The HTML body (with any theme-specific decorative elements)
4. `<script src>` tags loading the shared JS
5. An optional inline `<script>` for theme-specific behavior

---

## Creating a New Theme

### Step 1: Copy a theme directory

```bash
cp -r themes/default themes/my-theme
```

### Step 2: Edit each HTML file

Each file follows this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lane Overlay — My Theme</title>
    <link rel="stylesheet" href="../../css/lane-structure.css">
    <style>
        /* ===== MY THEME CSS ===== */
        :root {
            --theme-font: 'Arial', sans-serif;
            /* ... your color variables ... */
        }
        body { font-family: var(--theme-font); }
        /* ... all visual styling ... */
    </style>
</head>
<body>
    <!-- HTML structure (same as default, or add decorative elements) -->
    ...

    <script src="../../js/overlay-core.js"></script>
    <script src="../../js/lane-overlay.js"></script>
    <script>
        // Optional: theme-specific JS (hooks, decorations)
        SwimOverlay.init({ onData: processLaneData, numLanes: 8 });
    </script>
</body>
</html>
```

### Step 3: Customize the CSS

Edit the inline `<style>` in each file. Change colors, fonts, gradients, shadows, and animation keyframes. The structural CSS handles all layout — you only need to define the visual appearance.

### Step 4: Add to the Simulator

In `Simulator.html`, add your theme to the `<select id="themeSelect">`:

```html
<option value="my-theme">My Theme</option>
```

---

## SwimOverlay API

The shared JS exposes a `SwimOverlay` global with these members:

| Member | Description |
|---|---|
| `SwimOverlay.init({ onData, numLanes })` | Wire up comms. `onData` is the processing callback. `numLanes` defaults to 8. |
| `SwimOverlay.numLanes` | Read-only. Number of lanes configured. |
| `SwimOverlay.checkAllActiveFinished(laneAthleteTeam)` | Returns true when all assigned swimmers have a place. |
| `SwimOverlay.getPlaceText(place)` | Ordinal suffix: `"1"` → `"1st"`, `"2"` → `"2nd"`, etc. |
| `SwimOverlay.fragmentColors` | Array of 4 CSS colors for brick explosion fragments. Override to match your theme. |
| `SwimOverlay.onEventChange` | Hook function called when event number changes. Set to trigger theme effects (e.g. mascot run). |
| `SwimOverlay.onHeatChange` | Hook function called when heat number changes. |

### Init calls by overlay type

```js
// Lane overlay
SwimOverlay.init({ onData: processLaneData, numLanes: 8 });

// Timer overlay
SwimOverlay.init({ onData: processTimerData });

// Header overlay
SwimOverlay.onEventChange = myCustomEffect;  // optional
SwimOverlay.init({ onData: processHeaderData });
```

---

## CSS Selectors Reference

### Common Variables

Define these on `:root` for consistent theming:

| Variable | Purpose |
|---|---|
| `--theme-font` | Base font family |
| `--color-primary` | Main box background |
| `--color-text-primary` | Primary text color |
| `--color-text-secondary` | Secondary text color |
| `--border-width` | Box border thickness |
| `--border-radius` | Corner radius |
| `--shadow-color` | Shadow base color |

### Lane Overlay

| Selector | Purpose |
|---|---|
| `.lane-content` | Results box background, border, shadow |
| `.lane-content.visible` | Results appear animation |
| `.lane-content.hiding` | Results disappear animation |
| `.lineup-content` | Pre-race lineup box |
| `.lineup-content.visible` / `.hiding` | Lineup animations |
| `.lineup-name` | Swimmer name in lineup |
| `.lineup-team` | Team name in lineup |
| `.place-indicator` | Place number (1st, 2nd, etc.) |
| `.swimmer-name` | Swimmer name in results |
| `.final-time` | Final time display |
| `.lane-content.first-place` | First place background override |
| `.lane-content.second-place` | Second place background |
| `.lane-content.third-place` | Third place background |
| `.lane-indicator` | Lane number badge |
| `.split-content` | Split time box |
| `.split-content.visible` / `.hiding` | Split animations |
| `.split-time` | Split time text |

### Timer Overlay

| Selector | Purpose |
|---|---|
| `.timer-content` | Timer box background, border |
| `.timer-content.visible` | Timer appear animation |
| `.timer-content.hiding` | Timer disappear animation |
| `.timer-label` | "TIME" label |
| `.running-time` | Running clock text |
| `.timer-content::before` | Optional stopwatch decoration (set `display: none` to hide) |
| `.timer-content::after` | Optional stopwatch button |
| `.clock-hand` | Optional analog clock hand (needs `<div class="clock-hand" id="clockHand">` in HTML) |

### Header Overlay

| Selector | Purpose |
|---|---|
| `.header-box.fixed .header-content` | Event/Heat box styling |
| `.header-box.stretch .header-content` | Event name box styling |
| `.header-content.visible` | Header box appear animation |
| `.header-content.hiding` | Header box disappear animation |
| `.header-content.exploding` | Event/Heat number change — exit animation |
| `.header-content.appearing` | Event/Heat number change — enter animation |
| `.label` | "Event"/"Heat" labels |
| `.value` | Event/Heat numbers |
| `.event-name` | Event name text |
| `.event-name-copy` | Marquee duplicate (style same as `.event-name`) |

### Optional Theme Elements

These only need HTML + CSS if your theme uses them:

- **`.clock-hand`** — Analog clock hand in timer (add `<div class="clock-hand" id="clockHand">` to timer HTML)
- **`.mario-runner`** — Mascot sprite in header (add to header HTML, trigger via `SwimOverlay.onEventChange`)
- **Pipe end caps** — `::before`/`::after` on `.header-box.stretch .header-content` (set `display: none` if not used)

---

## Animation Triggers

The JavaScript applies CSS classes to trigger animations. Define `@keyframes` in your theme CSS:

### Lane Overlay

| Class Applied | When |
|---|---|
| `.lane-content.visible` | Lane finishes — results appear |
| `.lane-content.hiding` | Lane reset — results disappear |
| `.lineup-content.visible` | Pre-race — lineup appears |
| `.lineup-content.hiding` | Race starts — lineup disappears |
| `.split-content.visible` | Split time arrives |
| `.split-content.hiding` | Split time auto-hides |
| `.lane-content.first-place` | Swimmer finishes 1st |
| `.lane-content.second-place` | Swimmer finishes 2nd |
| `.lane-content.third-place` | Swimmer finishes 3rd |
| `.lane-indicator.brick-explode` | Lane has no swimmer (structural animation) |

### Header Overlay

| Class Applied | When |
|---|---|
| `.header-content.visible` | First data — boxes appear (stagger with `animation-delay`) |
| `.header-content.hiding` | Data clears — boxes disappear |
| `.header-content.exploding` | Event/Heat number changes — old value exits |
| `.header-content.appearing` | Event/Heat number changes — new value enters |

### Timer Overlay

| Class Applied | When |
|---|---|
| `.timer-content.visible` | Race starts (state 3) |
| `.timer-content.hiding` | Race ends or all finished |

---

## Quick-Start Checklist

1. Copy `themes/default/` to `themes/my-theme/`
2. Define `:root` variables (fonts, colors, borders) in each file's `<style>`
3. Set `body { font-family: ... }`
4. Style each selector with your colors, gradients, shadows
5. Define `@keyframes` for each animation (or reuse defaults)
6. Add decorative elements to HTML if desired (clock hand, mascot, etc.)
7. Set `display: none` for any `::before`/`::after` pseudo-elements you don't use
8. Add your theme to `Simulator.html`'s theme dropdown
9. Test all three overlays via the Simulator
