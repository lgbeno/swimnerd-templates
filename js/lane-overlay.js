/**
 * Lane overlay data processing.
 * Depends on: overlay-core.js (SwimOverlay)
 */

const MAX_LANES = 10;
const SPLIT_DISPLAY_PERCENT = 0.4;
const SPLIT_SHOW_DELAY_MS = 500; // Delay before showing splits to avoid finish-split glitch
const FINAL_TIME_GUARD_MS = 10000; // Suppress finals for 10s after race starts

let laneVisibility = new Array(MAX_LANES).fill(false);
let splitVisibility = new Array(MAX_LANES).fill(false);
let lineupVisibility = new Array(MAX_LANES).fill(false);
let splitTimeouts = new Array(MAX_LANES).fill(null);
let splitPendingTimeouts = new Array(MAX_LANES).fill(null);
let lastSplitValue = new Array(MAX_LANES).fill(null);
let laneActivated = new Array(MAX_LANES).fill(false);
let laneIndicatorHidden = new Array(MAX_LANES).fill(false);
let explodeTimeouts = new Array(MAX_LANES).fill(null);

let lastScoreboardState = 0;
let raceStartTime = 0;
let lastEventNumber = null;
let lastHeatNumber = null;
// Display modes: 'lineup' (pre-race), 'racing' (race active), 'results' (race complete)
let displayMode = 'lineup';

function explodeLaneIndicator(laneNum) {
    const el = document.querySelector(`#lane-${laneNum} .lane-indicator`);
    if (!el || laneIndicatorHidden[laneNum - 1]) return;
    laneIndicatorHidden[laneNum - 1] = true;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Spawn brick fragments
    const colors = SwimOverlay.fragmentColors;
    for (let p = 0; p < 12; p++) {
        const frag = document.createElement('div');
        frag.className = 'brick-fragment';
        const angle = (Math.PI * 2 * p) / 12 + (Math.random() - 0.5) * 0.5;
        const dist = 30 + Math.random() * 50;
        frag.style.left = cx + 'px';
        frag.style.top = cy + 'px';
        frag.style.background = colors[p % colors.length];
        frag.style.setProperty('--fx', Math.cos(angle) * dist + 'px');
        frag.style.setProperty('--fy', (Math.sin(angle) * dist - 30) + 'px');
        document.body.appendChild(frag);
        setTimeout(() => frag.remove(), 600);
    }

    el.classList.add('brick-explode');
    if (explodeTimeouts[laneNum - 1]) clearTimeout(explodeTimeouts[laneNum - 1]);
    explodeTimeouts[laneNum - 1] = setTimeout(() => {
        el.style.visibility = 'hidden';
        explodeTimeouts[laneNum - 1] = null;
    }, 400);
}

function restoreLaneIndicator(laneNum) {
    const el = document.querySelector(`#lane-${laneNum} .lane-indicator`);
    if (!el || !laneIndicatorHidden[laneNum - 1]) return;
    laneIndicatorHidden[laneNum - 1] = false;
    // Cancel pending hide timeout to prevent it from firing after restore
    if (explodeTimeouts[laneNum - 1]) {
        clearTimeout(explodeTimeouts[laneNum - 1]);
        explodeTimeouts[laneNum - 1] = null;
    }
    el.classList.remove('brick-explode');
    el.style.visibility = '';
}

function resetAllLanes(laneAthleteTeam) {
    const numLanes = SwimOverlay.numLanes;
    for (let laneCounter = 0; laneCounter < numLanes; laneCounter++) {
        const laneNum = laneCounter + 1;
        const laneContent = document.getElementById(`laneContent-${laneNum}`);
        const splitContent = document.getElementById(`splitContent-${laneNum}`);
        const lineupContent = document.getElementById(`lineupContent-${laneNum}`);
        const swimmerName = document.getElementById(`swimmerName-${laneNum}`);
        const finalTime = document.getElementById(`finalTime-${laneNum}`);
        const placeIndicator = document.getElementById(`place-${laneNum}`);
        const splitTime = document.getElementById(`splitTime-${laneNum}`);
        const lineupLane = document.getElementById(`lineupLane-${laneNum}`);
        const lineupName = document.getElementById(`lineupName-${laneNum}`);
        const lineupTeam = document.getElementById(`lineupTeam-${laneNum}`);

        // Hide and clear lane content
        laneContent.classList.remove('visible', 'first-place', 'second-place', 'third-place');
        laneContent.classList.add('hiding');
        laneVisibility[laneCounter] = false;
        swimmerName.textContent = '';
        finalTime.textContent = '';
        placeIndicator.textContent = '';

        // Hide and clear split content
        splitContent.classList.remove('visible');
        splitContent.classList.add('hiding');
        splitVisibility[laneCounter] = false;
        splitTime.textContent = '';
        if (splitTimeouts[laneCounter]) {
            clearTimeout(splitTimeouts[laneCounter]);
            splitTimeouts[laneCounter] = null;
        }
        if (splitPendingTimeouts[laneCounter]) {
            clearTimeout(splitPendingTimeouts[laneCounter]);
            splitPendingTimeouts[laneCounter] = null;
        }

        // Hide and clear lineup content
        lineupContent.classList.remove('visible');
        lineupContent.classList.add('hiding');
        lineupVisibility[laneCounter] = false;
        lineupLane.textContent = '';
        lineupName.textContent = '';
        lineupTeam.textContent = '';

        // Pre-seed with current split data to prevent stale splits from showing
        lastSplitValue[laneCounter] = laneAthleteTeam
            ? laneAthleteTeam[laneCounter].SplitTime
            : null;

        laneActivated[laneCounter] = false;

        // Reset lane indicator state so it can re-explode/restore cleanly
        if (explodeTimeouts[laneCounter]) {
            clearTimeout(explodeTimeouts[laneCounter]);
            explodeTimeouts[laneCounter] = null;
        }
        laneIndicatorHidden[laneCounter] = false;
        const indicator = document.querySelector(`#lane-${laneNum} .lane-indicator`);
        if (indicator) {
            indicator.classList.remove('brick-explode');
            indicator.style.visibility = '';
        }
    }
}

function processLaneData(jsonData) {
    const numLanes = SwimOverlay.numLanes;
    const scoreboardState = jsonData.swimming.ScoreboardCurrentState || 0;
    const eventNum = jsonData.swimming.EventNumber;
    const heatNum = jsonData.swimming.HeatNumber;

    // Detect new event or heat — reset and show lineup or start racing
    const isNewEvent = lastEventNumber !== null &&
        (eventNum !== lastEventNumber || heatNum !== lastHeatNumber);

    if (isNewEvent) {
        resetAllLanes(jsonData.swimming.LaneAthleteTeam);
        if (scoreboardState === 3) {
            displayMode = 'racing';
            raceStartTime = Date.now();
        } else {
            displayMode = 'lineup';
        }
    }

    // Detect state transition to 3 (same event/heat) — race starting
    if (!isNewEvent && scoreboardState === 3 && lastScoreboardState !== 3) {
        resetAllLanes(jsonData.swimming.LaneAthleteTeam);
        displayMode = 'racing';
        raceStartTime = Date.now();
    }

    // Note: state leaving 3 does NOT change displayMode
    // Results persist until a new event/heat begins

    lastEventNumber = eventNum;
    lastHeatNumber = heatNum;
    lastScoreboardState = scoreboardState;

    // Check if all active lanes finished — transition to results mode
    // Only after guard period so stale Places from previous race don't trigger this
    const pastGuard = (Date.now() - raceStartTime) >= FINAL_TIME_GUARD_MS;
    if (displayMode === 'racing' && pastGuard && SwimOverlay.checkAllActiveFinished(jsonData.swimming.LaneAthleteTeam)) {
        displayMode = 'results';
    }

    for (let laneCounter = 0; laneCounter < numLanes; laneCounter++) {
        const laneNum = laneCounter + 1;
        const laneData = jsonData.swimming.LaneAthleteTeam[laneCounter];
        const laneContent = document.getElementById(`laneContent-${laneNum}`);
        const swimmerName = document.getElementById(`swimmerName-${laneNum}`);
        const finalTime = document.getElementById(`finalTime-${laneNum}`);
        const placeIndicator = document.getElementById(`place-${laneNum}`);
        const splitContent = document.getElementById(`splitContent-${laneNum}`);
        const splitTime = document.getElementById(`splitTime-${laneNum}`);
        const lineupContent = document.getElementById(`lineupContent-${laneNum}`);
        const lineupLane = document.getElementById(`lineupLane-${laneNum}`);
        const lineupName = document.getElementById(`lineupName-${laneNum}`);
        const lineupTeam = document.getElementById(`lineupTeam-${laneNum}`);

        const hasLaneNumber = laneData.LaneNumber.trim() !== "";
        const hasName = laneData.AthleteName && laneData.AthleteName.trim() !== "";
        const hasFinalTime = laneData.FinalTime && laneData.FinalTime.trim() !== "";
        // True final times have hundredths precision (e.g. "1:24.31"), while the
        // running clock only has tenths (e.g. "1:24.5"). Require hundredths to
        // avoid briefly displaying the running clock when Place arrives first.
        const isFinalTimeLocked = hasFinalTime && /\.\d{2}$/.test(laneData.FinalTime.trim());
        const hasPlace = laneData.Place && laneData.Place.trim() !== "" && laneData.Place.trim() !== " ";
        const hasSplitTime = laneData.SplitTime && laneData.SplitTime.trim() !== "" && laneData.SplitTime.trim() !== "." && /^\d/.test(laneData.SplitTime.trim());

        // Activate nameless lane when a new split arrives (evidence of a swimmer)
        const isNewSplit = hasSplitTime && laneData.SplitTime !== lastSplitValue[laneCounter];
        if (hasLaneNumber && !hasName && isNewSplit) {
            laneActivated[laneCounter] = true;
        }

        // Lane is displayable if it has a name, or was activated by receiving timing data
        const hasData = hasLaneNumber && (hasName || laneActivated[laneCounter]);
        const shouldShowFinal = hasData && isFinalTimeLocked && hasPlace && (displayMode === 'racing' || displayMode === 'results') && pastGuard;

        // Explode or restore lane indicator brick
        if (!hasData) {
            explodeLaneIndicator(laneNum);
        } else {
            restoreLaneIndicator(laneNum);
        }

        // Pre-race lineup display (only show lanes with names)
        if (hasLaneNumber && hasName && displayMode === 'lineup') {
            lineupLane.textContent = laneData.LaneNumber;
            lineupName.textContent = laneData.AthleteName;
            lineupTeam.textContent = laneData.Team || '';
            if (!lineupVisibility[laneCounter]) {
                lineupContent.classList.remove('hiding');
                lineupContent.classList.add('visible');
                lineupVisibility[laneCounter] = true;
            }
        } else {
            if (lineupVisibility[laneCounter]) {
                lineupContent.classList.remove('visible');
                lineupContent.classList.add('hiding');
                lineupVisibility[laneCounter] = false;
                setTimeout(() => {
                    if (!lineupVisibility[laneCounter]) {
                        lineupLane.textContent = '';
                        lineupName.textContent = '';
                        lineupTeam.textContent = '';
                    }
                }, 300);
            }
        }

        if (shouldShowFinal) {
            swimmerName.textContent = hasName ? laneData.AthleteName : `LANE ${laneData.LaneNumber.trim()}`;
            finalTime.textContent = laneData.FinalTime;
            laneContent.classList.remove('first-place', 'second-place', 'third-place');

            if (laneData.Place && laneData.Place.trim() !== "" && laneData.Place.trim() !== " ") {
                placeIndicator.textContent = SwimOverlay.getPlaceText(laneData.Place.trim());
                const place = laneData.Place.trim();
                if (place === "1") laneContent.classList.add('first-place');
                else if (place === "2") laneContent.classList.add('second-place');
                else if (place === "3") laneContent.classList.add('third-place');
            } else {
                placeIndicator.textContent = "";
            }

            if (!laneVisibility[laneCounter]) {
                laneContent.classList.remove('hiding');
                laneContent.classList.add('visible');
                laneVisibility[laneCounter] = true;
            }

            // Cancel any pending split display
            if (splitPendingTimeouts[laneCounter]) {
                clearTimeout(splitPendingTimeouts[laneCounter]);
                splitPendingTimeouts[laneCounter] = null;
            }
            if (splitVisibility[laneCounter]) {
                if (splitTimeouts[laneCounter]) {
                    clearTimeout(splitTimeouts[laneCounter]);
                    splitTimeouts[laneCounter] = null;
                }
                splitContent.classList.remove('visible');
                splitContent.classList.add('hiding');
                splitVisibility[laneCounter] = false;
                setTimeout(() => {
                    if (!splitVisibility[laneCounter]) splitTime.textContent = "";
                }, 300);
            }
        } else {
            if (laneVisibility[laneCounter]) {
                laneContent.classList.remove('visible');
                laneContent.classList.add('hiding');
                laneVisibility[laneCounter] = false;
                setTimeout(() => {
                    if (!laneVisibility[laneCounter]) {
                        swimmerName.textContent = "";
                        finalTime.textContent = "";
                        placeIndicator.textContent = "";
                        laneContent.classList.remove('first-place', 'second-place', 'third-place');
                    }
                }, 300);
            }

            if (hasData && hasSplitTime && displayMode === 'racing') {
                const isNewSplit = laneData.SplitTime !== lastSplitValue[laneCounter];
                if (isNewSplit) {
                    lastSplitValue[laneCounter] = laneData.SplitTime;
                    // Cancel any existing pending show
                    if (splitPendingTimeouts[laneCounter]) {
                        clearTimeout(splitPendingTimeouts[laneCounter]);
                        splitPendingTimeouts[laneCounter] = null;
                    }
                    if (splitTimeouts[laneCounter]) clearTimeout(splitTimeouts[laneCounter]);
                    const capturedSplitValue = laneData.SplitTime;
                    const lc = laneCounter;
                    // Delay showing split so finish-splits get cancelled by arriving Place
                    splitPendingTimeouts[lc] = setTimeout(() => {
                        splitPendingTimeouts[lc] = null;
                        if (displayMode !== 'racing') return;
                        const sc = document.getElementById(`splitContent-${lc + 1}`);
                        const st = document.getElementById(`splitTime-${lc + 1}`);
                        st.textContent = capturedSplitValue;
                        if (!splitVisibility[lc]) {
                            sc.classList.remove('hiding');
                            sc.classList.add('visible');
                            splitVisibility[lc] = true;
                        }
                        const sParts = capturedSplitValue.split(':');
                        const sSecs = sParts.length === 2
                            ? (parseFloat(sParts[0]) || 0) * 60 + (parseFloat(sParts[1]) || 0)
                            : parseFloat(capturedSplitValue) || 5;
                        const displayDuration = sSecs * SPLIT_DISPLAY_PERCENT * 1000;
                        splitTimeouts[lc] = setTimeout(() => {
                            sc.classList.remove('visible');
                            sc.classList.add('hiding');
                            splitVisibility[lc] = false;
                            setTimeout(() => {
                                if (!splitVisibility[lc]) st.textContent = "";
                            }, 300);
                        }, displayDuration);
                    }, SPLIT_SHOW_DELAY_MS);
                }
            }
        }
    }
}
