// Analyze capture timing without including roster or athlete information.
'use strict';
const fs = require('node:fs');
const { Decoder, parseCapture } = require('./cts6/decoder');
if (!process.argv[2]) {
    console.error('Usage: node js/analyze_cts6_clock.js /path/to/CTS6_Capture.csv');
    process.exit(1);
}
const chunks = parseCapture(fs.readFileSync(process.argv[2], 'utf8'));
const decoder = new Decoder(), clocks = [], perChunk = [];
for (const chunk of chunks) {
    let count = 0;
    for (const byte of chunk.bytes) {
        const sequence = decoder.clockSequence;
        decoder.feed([byte], chunk.at);
        if (decoder.clockSequence !== sequence) {
            clocks.push({ at: chunk.at, clock: decoder.clock, seconds: decoder.clockSeconds });
            count++;
        }
    }
    perChunk.push(count);
}
const sequence = decoder.clockSequence;
decoder.finish(chunks.at(-1).at);
if (decoder.clockSequence !== sequence) {
    clocks.push({ at: chunks.at(-1).at, clock: decoder.clock, seconds: decoder.clockSeconds });
    perChunk[perChunk.length - 1]++;
}
function stats(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)],
        p90: sorted[Math.floor(sorted.length * .9)], max: sorted.at(-1),
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}
const steps = {}, backwards = [];
for (let i = 1; i < clocks.length; i++) {
    const before = clocks[i - 1], after = clocks[i];
    if (before.seconds === null || after.seconds === null) continue;
    const delta = Math.round((after.seconds - before.seconds) * 10) / 10;
    steps[delta] = (steps[delta] || 0) + 1;
    if (delta < 0) backwards.push({ before, after, delta });
}
console.log(JSON.stringify({ chunks: chunks.length, clockUpdates: clocks.length,
    chunkGapsMs: stats(chunks.slice(1).map((c, i) => c.at - chunks[i].at)),
    clockUpdatesPerChunk: stats(perChunk), stepsSeconds: steps, backwards }, null, 2));
