/**
 * Timer overlay data processing.
 * Depends on: overlay-core.js (SwimOverlay)
 */

let timerVisible = false;
let lastScoreboardState = 0;
let raceStartTime = 0;
const FINAL_TIME_GUARD_MS = 10000;

function processTimerData(jsonData) {
    const timerContent = document.getElementById('timerContent');
    const runningTime = document.getElementById('runningTime');
    const clockHand = document.getElementById('clockHand');
    const time = jsonData.swimming.RunningTime;
    const scoreboardState = jsonData.swimming.ScoreboardCurrentState || 0;

    // Track race start for guard period
    if (scoreboardState === 3 && lastScoreboardState !== 3) {
        raceStartTime = Date.now();
    }
    lastScoreboardState = scoreboardState;

    const pastGuard = (Date.now() - raceStartTime) >= FINAL_TIME_GUARD_MS;
    const allFinished = pastGuard && SwimOverlay.checkAllActiveFinished(jsonData.swimming.LaneAthleteTeam);

    // Timer visible only when race is actively running (state 3 and not all finished)
    if (scoreboardState === 3 && !allFinished) {
        runningTime.textContent = time;

        // Update clock hand rotation (if element exists — theme-dependent)
        if (clockHand) {
            const parts = time.split(':');
            if (parts.length === 2) {
                const secs = parseFloat(parts[1]) || 0;
                clockHand.style.setProperty('--seconds', secs % 60);
            }
        }

        if (!timerVisible) {
            timerContent.classList.remove('hiding');
            timerContent.classList.add('visible');
            timerVisible = true;
        }
    } else {
        if (timerVisible) {
            timerContent.classList.remove('visible');
            timerContent.classList.add('hiding');
            timerVisible = false;
            setTimeout(() => {
                if (!timerVisible) runningTime.textContent = '';
            }, 300);
        }
    }
}
