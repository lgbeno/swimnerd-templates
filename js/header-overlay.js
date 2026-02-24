/**
 * Header overlay data processing.
 * Depends on: overlay-core.js (SwimOverlay)
 */

let eventVisible = false;
let heatVisible = false;
let nameVisible = false;
let lastEventName = '';
let lastEventNumber = '';
let lastHeatNumber = '';
let eventExploding = false;
let heatExploding = false;

function triggerEventExplode(newValue) {
    if (eventExploding) return;
    eventExploding = true;

    const eventContent = document.getElementById('eventContent');
    const eventNumberEl = document.getElementById('eventNumber');

    // Remove other classes and add exploding
    eventContent.classList.remove('visible', 'hiding', 'appearing');
    eventContent.classList.add('exploding');

    // After explode, update value and appear
    setTimeout(() => {
        eventNumberEl.textContent = newValue;
        eventContent.classList.remove('exploding');
        eventContent.classList.add('appearing');

        // After appear animation completes, just clear the flag
        setTimeout(() => {
            eventExploding = false;
        }, 350);
    }, 350);
}

function triggerHeatExplode(newValue) {
    if (heatExploding) return;
    heatExploding = true;

    const heatContent = document.getElementById('heatContent');
    const heatNumberEl = document.getElementById('heatNumber');

    // Remove other classes and add exploding
    heatContent.classList.remove('visible', 'hiding', 'appearing');
    heatContent.classList.add('exploding');

    // After explode, update value and appear
    setTimeout(() => {
        heatNumberEl.textContent = newValue;
        heatContent.classList.remove('exploding');
        heatContent.classList.add('appearing');

        // After appear animation completes, just clear the flag
        setTimeout(() => {
            heatExploding = false;
        }, 350);
    }, 350);
}

function processHeaderData(jsonData) {
    const eventContent = document.getElementById('eventContent');
    const heatContent = document.getElementById('heatContent');
    const nameContent = document.getElementById('nameContent');
    const eventNumberEl = document.getElementById('eventNumber');
    const heatNumberEl = document.getElementById('heatNumber');
    const eventNameEl = document.getElementById('eventName');

    const eventNum = jsonData.swimming.EventNumber;
    const heatNum = jsonData.swimming.HeatNumber;
    const name = jsonData.swimming.EventName;

    // Handle Event Number - skip all processing during explosion
    if (!eventExploding) {
        if (eventNum) {
            // Check if number changed - trigger explode animation
            if (eventNum !== lastEventNumber && lastEventNumber !== '' && eventVisible) {
                triggerEventExplode(eventNum);
                // Notify theme (e.g. mario runner)
                if (SwimOverlay.onEventChange) SwimOverlay.onEventChange(eventNum);
                lastEventNumber = eventNum;
            } else {
                eventNumberEl.textContent = eventNum;
                if (!eventVisible) {
                    eventContent.classList.remove('hiding', 'appearing', 'exploding');
                    eventContent.classList.add('visible');
                    eventVisible = true;
                }
                lastEventNumber = eventNum;
            }
        } else {
            if (eventVisible) {
                eventContent.classList.remove('visible', 'appearing', 'exploding');
                eventContent.classList.add('hiding');
                eventVisible = false;
                setTimeout(() => { if (!eventVisible) eventNumberEl.textContent = ''; }, 300);
            }
        }
    }

    // Handle Heat Number - skip all processing during explosion
    if (!heatExploding) {
        if (heatNum) {
            // Check if number changed - trigger explode animation
            if (heatNum !== lastHeatNumber && lastHeatNumber !== '' && heatVisible) {
                triggerHeatExplode(heatNum);
                // Notify theme
                if (SwimOverlay.onHeatChange) SwimOverlay.onHeatChange(heatNum);
                lastHeatNumber = heatNum;
            } else {
                heatNumberEl.textContent = heatNum;
                if (!heatVisible) {
                    heatContent.classList.remove('hiding', 'appearing', 'exploding');
                    heatContent.classList.add('visible');
                    heatVisible = true;
                }
                lastHeatNumber = heatNum;
            }
        } else {
            if (heatVisible) {
                heatContent.classList.remove('visible', 'appearing', 'exploding');
                heatContent.classList.add('hiding');
                heatVisible = false;
                setTimeout(() => { if (!heatVisible) heatNumberEl.textContent = ''; }, 300);
            }
        }
    }

    if (name) {
        lastEventName = name;

        eventNameEl.textContent = name;
        if (!nameVisible) {
            nameContent.classList.remove('hiding');
            nameContent.classList.add('visible');
            nameVisible = true;
        }

        // Check for overflow and enable scrolling if needed
        checkEventNameOverflow();
    } else {
        if (nameVisible) {
            nameContent.classList.remove('visible');
            nameContent.classList.add('hiding');
            nameVisible = false;
            setTimeout(() => {
                if (!nameVisible) {
                    eventNameEl.textContent = '';
                    document.getElementById('eventNameCopy').textContent = '';
                    const wrapper = document.getElementById('eventNameWrapper');
                    wrapper.classList.remove('scrolling');
                }
            }, 300);
        }
    }
}

function checkEventNameOverflow() {
    const wrapper = document.getElementById('eventNameWrapper');
    const track = document.getElementById('eventNameTrack');
    const eventNameEl = document.getElementById('eventName');
    const eventNameCopy = document.getElementById('eventNameCopy');

    // Update the copy text
    eventNameCopy.textContent = eventNameEl.textContent;

    // Wait for web fonts to load before measuring, then wait a frame for layout
    document.fonts.ready.then(() => {
        requestAnimationFrame(() => {
            const wrapperWidth = wrapper.offsetWidth;
            const textWidth = eventNameEl.offsetWidth;
            const gap = 100; // padding-left on the copy

            if (textWidth > wrapperWidth) {
                // Calculate exact scroll distance (text width + gap)
                const scrollDistance = textWidth + gap;
                // Calculate scroll duration based on distance (roughly 80px per second)
                const scrollDuration = Math.max(8, scrollDistance / 80);

                track.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
                track.style.setProperty('--scroll-duration', scrollDuration + 's');
                wrapper.classList.add('scrolling');
            } else {
                wrapper.classList.remove('scrolling');
            }
        });
    });
}
