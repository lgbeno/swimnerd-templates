/**
 * Tests that the Simulator's JSON output format matches the real scoreboard
 * log files captured from ACS systems. Loads actual log files as the
 * reference schema and validates that buildJsonData() produces conforming
 * output.
 */

var fs = require('fs');
var path = require('path');

var testDir = path.join(__dirname, '..', 'test_logs');
var allPass = true;
var testCount = 0;
var failCount = 0;

function assert(condition, msg) {
  testCount++;
  if (!condition) {
    failCount++;
    allPass = false;
    console.log('  FAIL: ' + msg);
  }
}

// ── Load a reference entry from a real log file ──────────────────────

function loadReferenceEntry() {
  var files = fs.readdirSync(testDir).filter(function (f) {
    return f.endsWith('.json') && f.indexOf('.compressed') === -1;
  });
  if (files.length === 0) {
    console.log('No log files found in test_logs/');
    process.exit(1);
  }
  var data = JSON.parse(fs.readFileSync(path.join(testDir, files[0]), 'utf8'));
  return data[0].data;
}

// ── Replicate Simulator's buildJsonData (no DOM) ─────────────────────

function formatRunningTime(totalSeconds) {
  var mins = Math.floor(totalSeconds / 60);
  if (mins > 0) {
    var secs = (totalSeconds % 60).toFixed(1).padStart(4, '0');
    return ' ' + mins + ':' + secs + ' ';
  }
  var secs = (totalSeconds % 60).toFixed(1).padStart(4, ' ');
  return '  :' + secs + ' ';
}

function formatFinalTime(totalSeconds) {
  var mins = Math.floor(totalSeconds / 60);
  var secs = (totalSeconds % 60).toFixed(2).padStart(5, '0');
  if (mins > 0) {
    return ' ' + mins + ':' + secs;
  }
  return '  :' + secs;
}

function buildSimulatorPayload() {
  // Mimic what buildJsonData() produces during a race simulation
  var NUM_LANES = 8;
  var lanes = [];
  for (var i = 1; i <= NUM_LANES; i++) {
    var name = (i >= 2 && i <= 7) ? 'JOHN SMITH' : '';
    var hasData = name.trim() !== '';
    var nameParts = name.trim().split(/\s+/);
    var firstname = nameParts.length > 0 ? nameParts[0] : '';
    var lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    lanes.push({
      LaneID: i,
      LaneNumber: hasData ? String(i) : ' ',
      AthleteName: name,
      Team: hasData ? 'TEST' : '',
      SplitTime: hasData ? '.' : '.',
      FinalTime: '  : 0.0 ',
      Place: ' ',
      Firstname: firstname,
      Middlename: '',
      Lastname: lastname,
      NameFormatDisplayAs: 9,
      NameCaseDisplayAs: 0
    });
  }

  // Padding lanes 9-10 to match real ACS scoreboard format
  for (var j = NUM_LANES + 1; j <= 10; j++) {
    lanes.push({
      LaneID: j,
      LaneNumber: ' ',
      AthleteName: '',
      Team: '',
      SplitTime: '',
      FinalTime: '',
      Place: ' ',
      Firstname: '',
      Middlename: '',
      Lastname: '',
      NameFormatDisplayAs: 9,
      NameCaseDisplayAs: 0
    });
  }

  return {
    dbLiveScoreboardEvent: null,
    swimming: {
      TimeOfDay: '7:00',
      EventName: '100 FREE',
      EventRecord: '',
      EventNumber: 1,
      HeatNumber: 1,
      Lengths: 4,
      RunningTime: '  : 0.0 ',
      HomeScore: 0,
      Guest1Score: 0,
      Guest2Score: 0,
      Guest3Score: 0,
      Mod15: '',
      ScoreboardCurrentState: 3,
      ExportLiveResults: false,
      TimeStandard1: '',
      TimeStandard2: '',
      TimeStandard3: '',
      EventHeatName: 'Event: 1 Heat: 1 - 100 FREE',
      EventNumberName: '1: 100 FREE',
      LaneAthleteTeam: lanes
    }
  };
}

// ── Schema extracted from log files ──────────────────────────────────

var SWIMMING_FIELDS = [
  'TimeOfDay', 'EventName', 'EventRecord', 'EventNumber', 'HeatNumber',
  'Lengths', 'RunningTime', 'HomeScore', 'Guest1Score', 'Guest2Score',
  'Guest3Score', 'Mod15', 'ScoreboardCurrentState', 'ExportLiveResults',
  'TimeStandard1', 'TimeStandard2', 'TimeStandard3', 'EventHeatName',
  'EventNumberName', 'LaneAthleteTeam'
];

var LANE_FIELDS = [
  'LaneID', 'LaneNumber', 'AthleteName', 'Team', 'SplitTime',
  'FinalTime', 'Place', 'Firstname', 'Middlename', 'Lastname',
  'NameFormatDisplayAs', 'NameCaseDisplayAs'
];

// ══════════════════════════════════════════════════════════════════════
// TEST 1: Log files conform to expected schema
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 1: Log file schema validation');
(function () {
  var files = fs.readdirSync(testDir).filter(function (f) {
    return f.endsWith('.json') && f.indexOf('.compressed') === -1;
  });
  files.forEach(function (file) {
    var data = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf8'));
    var entry = data[0].data;

    assert(entry.hasOwnProperty('dbLiveScoreboardEvent'),
      file + ': missing dbLiveScoreboardEvent');
    assert(entry.hasOwnProperty('swimming'),
      file + ': missing swimming');

    var sw = entry.swimming;
    SWIMMING_FIELDS.forEach(function (field) {
      assert(sw.hasOwnProperty(field),
        file + ': swimming missing field "' + field + '"');
    });

    assert(Array.isArray(sw.LaneAthleteTeam),
      file + ': LaneAthleteTeam is not an array');

    // Every log file should have 10 lanes
    assert(sw.LaneAthleteTeam.length === 10,
      file + ': LaneAthleteTeam has ' + sw.LaneAthleteTeam.length + ' entries, expected 10');

    sw.LaneAthleteTeam.forEach(function (lane, idx) {
      LANE_FIELDS.forEach(function (field) {
        assert(lane.hasOwnProperty(field),
          file + ': lane ' + idx + ' missing field "' + field + '"');
      });
    });
  });
  console.log('  done (' + files.length + ' files checked)');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 2: Simulator payload has all required fields
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 2: Simulator payload has all required fields');
(function () {
  var sim = buildSimulatorPayload();

  assert(sim.hasOwnProperty('dbLiveScoreboardEvent'),
    'missing dbLiveScoreboardEvent');
  assert(sim.dbLiveScoreboardEvent === null,
    'dbLiveScoreboardEvent should be null, got: ' + sim.dbLiveScoreboardEvent);
  assert(sim.hasOwnProperty('swimming'),
    'missing swimming');

  var sw = sim.swimming;
  SWIMMING_FIELDS.forEach(function (field) {
    assert(sw.hasOwnProperty(field),
      'swimming missing field "' + field + '"');
  });

  sw.LaneAthleteTeam.forEach(function (lane, idx) {
    LANE_FIELDS.forEach(function (field) {
      assert(lane.hasOwnProperty(field),
        'lane ' + idx + ' missing field "' + field + '"');
    });
  });
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 3: Simulator should NOT have extra fields absent from logs
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 3: No extra fields in Simulator output');
(function () {
  var ref = loadReferenceEntry();
  var sim = buildSimulatorPayload();

  // Top-level keys
  Object.keys(sim).forEach(function (key) {
    assert(ref.hasOwnProperty(key),
      'Simulator has extra top-level key "' + key + '"');
  });

  // Swimming keys
  Object.keys(sim.swimming).forEach(function (key) {
    assert(ref.swimming.hasOwnProperty(key),
      'Simulator has extra swimming key "' + key + '"');
  });

  // Lane keys
  var refLane = ref.swimming.LaneAthleteTeam[0];
  var simLane = sim.swimming.LaneAthleteTeam[0];
  Object.keys(simLane).forEach(function (key) {
    assert(refLane.hasOwnProperty(key),
      'Simulator has extra lane key "' + key + '"');
  });
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 4: Field types match between Simulator and log files
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 4: Field types match');
(function () {
  var ref = loadReferenceEntry();
  var sim = buildSimulatorPayload();

  // swimming-level field types
  SWIMMING_FIELDS.forEach(function (field) {
    if (field === 'LaneAthleteTeam') return;
    var refType = typeof ref.swimming[field];
    var simType = typeof sim.swimming[field];
    assert(refType === simType,
      'swimming.' + field + ' type mismatch: log=' + refType + ', sim=' + simType +
      ' (log value: ' + JSON.stringify(ref.swimming[field]) +
      ', sim value: ' + JSON.stringify(sim.swimming[field]) + ')');
  });

  // lane-level field types (check an active lane)
  var refLane = ref.swimming.LaneAthleteTeam[2]; // lane 3, likely has athlete
  var simLane = sim.swimming.LaneAthleteTeam[2]; // lane 3, has athlete
  LANE_FIELDS.forEach(function (field) {
    var refType = typeof refLane[field];
    var simType = typeof simLane[field];
    assert(refType === simType,
      'lane.' + field + ' type mismatch: log=' + refType + ', sim=' + simType);
  });
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 5: LaneAthleteTeam should have 10 entries (8 active + 2 padding)
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 5: LaneAthleteTeam lane count');
(function () {
  var sim = buildSimulatorPayload();
  assert(sim.swimming.LaneAthleteTeam.length === 10,
    'Simulator produces ' + sim.swimming.LaneAthleteTeam.length +
    ' lanes, expected 10 (8 active + 2 padding)');
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 6: Padding lanes (9-10) match log file format
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 6: Padding lanes 9-10 format');
(function () {
  var sim = buildSimulatorPayload();
  if (sim.swimming.LaneAthleteTeam.length < 10) {
    assert(false, 'Cannot test padding lanes — only ' +
      sim.swimming.LaneAthleteTeam.length + ' lanes present');
    return;
  }

  [8, 9].forEach(function (idx) {
    var lane = sim.swimming.LaneAthleteTeam[idx];
    var laneNum = idx + 1;
    assert(lane.LaneID === laneNum,
      'Padding lane ' + laneNum + ' LaneID should be ' + laneNum + ', got ' + lane.LaneID);
    assert(lane.LaneNumber === ' ',
      'Padding lane ' + laneNum + ' LaneNumber should be " ", got ' + JSON.stringify(lane.LaneNumber));
    assert(lane.AthleteName === '',
      'Padding lane ' + laneNum + ' AthleteName should be empty');
    assert(lane.Team === '',
      'Padding lane ' + laneNum + ' Team should be empty');
    assert(lane.SplitTime === '',
      'Padding lane ' + laneNum + ' SplitTime should be "", got ' + JSON.stringify(lane.SplitTime));
    assert(lane.FinalTime === '',
      'Padding lane ' + laneNum + ' FinalTime should be "", got ' + JSON.stringify(lane.FinalTime));
    assert(lane.Place === ' ',
      'Padding lane ' + laneNum + ' Place should be " "');
  });
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 7: Active lanes with no athlete should still have LaneNumber
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 7: Empty active lanes keep their LaneNumber');
(function () {
  // Verify from log files: lanes 1-8 with no athlete still can have LaneNumber
  // In real data, lane numbering depends on scoreboard — some empty lanes have
  // their number, some have " ". The Simulator should follow the same pattern:
  // if a lane is in the 1-8 range and has a name, LaneNumber = String(i).
  // This test just verifies the Simulator sets LaneNumber for populated lanes.
  var sim = buildSimulatorPayload();
  sim.swimming.LaneAthleteTeam.forEach(function (lane, idx) {
    if (idx >= 8) return; // skip padding
    if (lane.AthleteName.trim() !== '') {
      assert(lane.LaneNumber === String(idx + 1),
        'Active lane ' + (idx + 1) + ' with athlete should have LaneNumber="' +
        (idx + 1) + '", got ' + JSON.stringify(lane.LaneNumber));
    }
  });
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 8: formatRunningTime matches log file patterns
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 8: formatRunningTime format');
(function () {
  // From logs: "  : 0.0 ", "  :11.6 ", " 1:05.3 "
  assert(formatRunningTime(0) === '  : 0.0 ',
    'formatRunningTime(0) = ' + JSON.stringify(formatRunningTime(0)) + ', expected "  : 0.0 "');
  assert(formatRunningTime(11.6) === '  :11.6 ',
    'formatRunningTime(11.6) = ' + JSON.stringify(formatRunningTime(11.6)) + ', expected "  :11.6 "');
  assert(formatRunningTime(65.3) === ' 1:05.3 ',
    'formatRunningTime(65.3) = ' + JSON.stringify(formatRunningTime(65.3)) + ', expected " 1:05.3 "');
  assert(formatRunningTime(605.9) === ' 10:05.9 ',
    'formatRunningTime(605.9) = ' + JSON.stringify(formatRunningTime(605.9)) + ', expected " 10:05.9 "');
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 9: formatFinalTime matches log file patterns
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 9: formatFinalTime format');
(function () {
  // From logs: "  :51.84", " 1:07.29", "  :40.55"
  assert(formatFinalTime(51.84) === '  :51.84',
    'formatFinalTime(51.84) = ' + JSON.stringify(formatFinalTime(51.84)) + ', expected "  :51.84"');
  assert(formatFinalTime(67.29) === ' 1:07.29',
    'formatFinalTime(67.29) = ' + JSON.stringify(formatFinalTime(67.29)) + ', expected " 1:07.29"');
  assert(formatFinalTime(40.55) === '  :40.55',
    'formatFinalTime(40.55) = ' + JSON.stringify(formatFinalTime(40.55)) + ', expected "  :40.55"');
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 10: Field ordering matches log files
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 10: Field ordering');
(function () {
  var ref = loadReferenceEntry();
  var sim = buildSimulatorPayload();

  var refSwimKeys = Object.keys(ref.swimming);
  var simSwimKeys = Object.keys(sim.swimming);
  assert(JSON.stringify(refSwimKeys) === JSON.stringify(simSwimKeys),
    'swimming field order mismatch:\n    log:  ' + JSON.stringify(refSwimKeys) +
    '\n    sim:  ' + JSON.stringify(simSwimKeys));

  var refLaneKeys = Object.keys(ref.swimming.LaneAthleteTeam[0]);
  var simLaneKeys = Object.keys(sim.swimming.LaneAthleteTeam[0]);
  assert(JSON.stringify(refLaneKeys) === JSON.stringify(simLaneKeys),
    'lane field order mismatch:\n    log:  ' + JSON.stringify(refLaneKeys) +
    '\n    sim:  ' + JSON.stringify(simLaneKeys));
  console.log('  done');
})();

// ══════════════════════════════════════════════════════════════════════
// TEST 11: Verify across all log files for consistency
// ══════════════════════════════════════════════════════════════════════
console.log('\nTest 11: All log files have consistent lane count of 10');
(function () {
  var files = fs.readdirSync(testDir).filter(function (f) {
    return f.endsWith('.json') && f.indexOf('.compressed') === -1;
  });
  files.forEach(function (file) {
    var data = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf8'));
    // Check first, middle, and last entries
    var indices = [0, Math.floor(data.length / 2), data.length - 1];
    indices.forEach(function (idx) {
      var count = data[idx].data.swimming.LaneAthleteTeam.length;
      assert(count === 10,
        file + ' entry ' + idx + ': LaneAthleteTeam has ' + count + ' lanes, expected 10');
    });
  });
  console.log('  done');
})();

// ── Summary ──────────────────────────────────────────────────────────

console.log('\n' + (allPass ? 'ALL PASSED' : failCount + ' FAILED') +
  ' (' + testCount + ' assertions)\n');
process.exit(allPass ? 0 : 1);
