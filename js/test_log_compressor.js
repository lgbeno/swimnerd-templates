var fs = require('fs');
var path = require('path');
var LogCompressor = require('./LogCompressor');

var testDir = path.join(__dirname, '..', 'test_logs');
var files = fs.readdirSync(testDir).filter(function (f) {
  return f.endsWith('.json') && f.indexOf('.compressed') === -1;
});

if (files.length === 0) {
  console.log('No .json files found in test_logs/');
  process.exit(1);
}

var allPass = true;

// Normalize sub-1s clock format: "  :  .X " -> "  : 0.X " (TICK sentinel resolves to canonical form)
function normalizeClockStr(s) {
  return s.replace(/  :  \./g, '  : 0.');
}

files.forEach(function (file) {
  var filePath = path.join(testDir, file);
  var raw = fs.readFileSync(filePath, 'utf8');
  var entries = JSON.parse(raw);

  var compressed = LogCompressor.compress(entries);
  var decompressed = LogCompressor.decompress(compressed);

  var origStr = normalizeClockStr(JSON.stringify(entries));
  var decompStr = normalizeClockStr(JSON.stringify(decompressed));
  var pass = origStr === decompStr;

  var origSize = Buffer.byteLength(raw, 'utf8');
  var compStr = JSON.stringify(compressed);
  var compSize = Buffer.byteLength(compStr, 'utf8');
  var ratio = ((1 - compSize / origSize) * 100).toFixed(1);

  var status = pass ? 'PASS' : 'FAIL';
  console.log(
    file + ': ' + status +
    ' | orig: ' + (origSize / 1024).toFixed(1) + 'KB' +
    ', comp: ' + (compSize / 1024).toFixed(1) + 'KB' +
    ', ratio: ' + ratio + '%' +
    ' | entries: ' + entries.length +
    ', deltas: ' + compressed.deltas.length
  );

  if (!pass) {
    allPass = false;
    // Find and report first difference
    var maxLen = Math.max(entries.length, decompressed.length);
    for (var i = 0; i < maxLen; i++) {
      var origEntry = JSON.stringify(entries[i]);
      var decEntry = JSON.stringify(decompressed[i]);
      if (origEntry !== decEntry) {
        console.log('  First difference at entry ' + i + ' (t=' + (entries[i] ? entries[i].t : 'N/A') + ')');
        if (i >= decompressed.length) {
          console.log('  Decompressed is missing this entry');
        } else if (i >= entries.length) {
          console.log('  Decompressed has extra entry');
        } else {
          // Find the differing key path
          findDiff(entries[i], decompressed[i], '  ');
        }
        break;
      }
    }
  }
});

function findDiff(a, b, indent) {
  if (typeof a !== typeof b) {
    console.log(indent + 'Type mismatch: ' + typeof a + ' vs ' + typeof b);
    return;
  }
  if (typeof a !== 'object' || a === null || b === null) {
    console.log(indent + 'Value: ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    console.log(indent + 'Array/Object mismatch');
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      console.log(indent + 'Array length: ' + a.length + ' vs ' + b.length);
    }
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
        console.log(indent + '[' + i + ']:');
        findDiff(a[i], b[i], indent + '  ');
        return;
      }
    }
  } else {
    var allKeys = Object.keys(a).concat(Object.keys(b).filter(function (k) { return !a.hasOwnProperty(k); }));
    for (var j = 0; j < allKeys.length; j++) {
      var key = allKeys[j];
      if (!b.hasOwnProperty(key)) {
        console.log(indent + '.' + key + ': missing in decompressed');
        return;
      }
      if (!a.hasOwnProperty(key)) {
        console.log(indent + '.' + key + ': extra in decompressed');
        return;
      }
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        console.log(indent + '.' + key + ':');
        findDiff(a[key], b[key], indent + '  ');
        return;
      }
    }
  }
}

// --- Test addEntry/applyDict incremental path ---
console.log('\n--- addEntry/applyDict roundtrip ---');
files.forEach(function (file) {
  var filePath = path.join(testDir, file);
  var entries = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Build compressed incrementally, just like DataLogger would
  var inc = null;
  for (var i = 0; i < entries.length; i++) {
    inc = LogCompressor.addEntry(inc, entries[i].t, entries[i].data);
  }
  var final = LogCompressor.applyDict(inc);
  var decompressed = LogCompressor.decompress(final);

  var origStr = normalizeClockStr(JSON.stringify(entries));
  var decStr = normalizeClockStr(JSON.stringify(decompressed));
  var pass = origStr === decStr;

  console.log(file + ' (incremental): ' + (pass ? 'PASS' : 'FAIL'));
  if (!pass) {
    allPass = false;
    for (var j = 0; j < Math.max(entries.length, decompressed.length); j++) {
      if (JSON.stringify(entries[j]) !== JSON.stringify(decompressed[j])) {
        console.log('  First difference at entry ' + j);
        findDiff(entries[j], decompressed[j], '  ');
        break;
      }
    }
  }
});

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(allPass ? 0 : 1);
