(function () {
  'use strict';

  var DELETED = '__$DEL$__';
  var RT_SENTINEL = '=RT';
  var TICK_SENTINEL = '=TICK';

  // Parse RunningTime string " M:SS.T " to integer tenths (avoids float issues)
  function parseRT(str) {
    if (!str || str.length < 7) return null;
    var minStr = str.substring(0, 2).trim();
    var secStr = str.substring(3, 5).trim();
    var tenStr = str.charAt(6);
    var minutes = minStr.length > 0 ? parseInt(minStr, 10) : 0;
    var seconds = secStr.length > 0 ? parseInt(secStr, 10) : 0;
    var tenths = parseInt(tenStr, 10);
    if (isNaN(minutes) || isNaN(seconds) || isNaN(tenths)) return null;
    return minutes * 600 + seconds * 10 + tenths;
  }

  // Format integer tenths back to the exact padded " M:SS.T " string
  function formatRT(tenths) {
    var minutes = Math.floor(tenths / 600);
    var remaining = tenths % 600;
    var seconds = Math.floor(remaining / 10);
    var t = remaining % 10;
    var minPart = minutes === 0 ? '  ' : (minutes < 10 ? ' ' + minutes : '' + minutes);
    var secPart;
    if (minutes > 0) {
      secPart = (seconds < 10 ? '0' : '') + seconds;
    } else {
      secPart = (seconds < 10 ? ' ' : '') + seconds;
    }
    return minPart + ':' + secPart + '.' + t + ' ';
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Recursive diff: returns undefined if no changes, otherwise the delta
  function diff(prev, curr) {
    if (prev === curr) return undefined;
    if (prev === null || curr === null || typeof prev !== 'object' || typeof curr !== 'object') {
      return curr;
    }

    var prevIsArray = Array.isArray(prev);
    var currIsArray = Array.isArray(curr);

    // Type changed between array and object — full replacement
    if (prevIsArray !== currIsArray) return deepClone(curr);

    if (currIsArray) {
      var delta = {};
      var hasChanges = false;
      var maxLen = Math.max(prev.length, curr.length);

      for (var i = 0; i < maxLen; i++) {
        if (i >= prev.length) {
          delta[String(i)] = deepClone(curr[i]);
          hasChanges = true;
        } else if (i >= curr.length) {
          delta[String(i)] = DELETED;
          hasChanges = true;
        } else {
          var elemDiff = diff(prev[i], curr[i]);
          if (elemDiff !== undefined) {
            delta[String(i)] = elemDiff;
            hasChanges = true;
          }
        }
      }

      if (prev.length !== curr.length) {
        delta['__len'] = curr.length;
        hasChanges = true;
      }

      return hasChanges ? delta : undefined;
    }

    // Object diff
    var objDelta = {};
    var objHasChanges = false;

    var currKeys = Object.keys(curr);
    for (var ci = 0; ci < currKeys.length; ci++) {
      var key = currKeys[ci];
      if (!prev.hasOwnProperty(key)) {
        objDelta[key] = deepClone(curr[key]);
        objHasChanges = true;
      } else {
        var valDiff = diff(prev[key], curr[key]);
        if (valDiff !== undefined) {
          objDelta[key] = valDiff;
          objHasChanges = true;
        }
      }
    }

    // Detect deleted keys
    var prevKeys = Object.keys(prev);
    for (var pi = 0; pi < prevKeys.length; pi++) {
      if (!curr.hasOwnProperty(prevKeys[pi])) {
        objDelta[prevKeys[pi]] = DELETED;
        objHasChanges = true;
      }
    }

    return objHasChanges ? objDelta : undefined;
  }

  // Apply delta to state, mutating and returning it
  function applyDelta(state, delta) {
    if (delta === null || typeof delta !== 'object' || Array.isArray(delta) ||
        typeof state !== 'object' || state === null) {
      return delta;
    }

    // delta is always a plain object (even for array diffs)
    if (Array.isArray(state)) {
      var deltaKeys = Object.keys(delta);
      for (var ai = 0; ai < deltaKeys.length; ai++) {
        var dk = deltaKeys[ai];
        if (dk === '__len') continue;
        var idx = parseInt(dk, 10);
        if (isNaN(idx)) continue;

        var val = delta[dk];
        if (val === DELETED) continue; // handled by __len

        if (idx < state.length && state[idx] !== null &&
            typeof state[idx] === 'object' &&
            typeof val === 'object' && val !== null && !Array.isArray(val)) {
          state[idx] = applyDelta(state[idx], val);
        } else {
          // Grow array if needed
          while (state.length <= idx) state.push(undefined);
          state[idx] = val;
        }
      }

      if (delta.hasOwnProperty('__len')) {
        state.length = delta['__len'];
      }

      return state;
    }

    // Plain object
    var objKeys = Object.keys(delta);
    for (var oi = 0; oi < objKeys.length; oi++) {
      var k = objKeys[oi];
      var v = delta[k];
      if (v === DELETED) {
        delete state[k];
      } else if (state.hasOwnProperty(k) && state[k] !== null &&
                 typeof state[k] === 'object' &&
                 typeof v === 'object' && v !== null && !Array.isArray(v)) {
        state[k] = applyDelta(state[k], v);
      } else {
        state[k] = v;
      }
    }

    return state;
  }

  // Resolve RT sentinels in full state after applying a delta
  function resolveRTSentinels(state) {
    if (!state || !state.swimming) return;
    var rt = state.swimming.RunningTime;
    var lanes = state.swimming.LaneAthleteTeam;
    if (!lanes || !Array.isArray(lanes)) return;
    for (var i = 0; i < lanes.length; i++) {
      if (lanes[i] && lanes[i].FinalTime === RT_SENTINEL) {
        lanes[i].FinalTime = rt;
      }
    }
  }

  // Replace FinalTime with =RT sentinel where it matches RunningTime (mutates in place)
  function sentinelizeRT(data) {
    if (!data || !data.swimming) return;
    var rt = data.swimming.RunningTime;
    if (!rt) return;
    var lanes = data.swimming.LaneAthleteTeam;
    if (!lanes || !Array.isArray(lanes)) return;
    for (var i = 0; i < lanes.length; i++) {
      if (lanes[i] && lanes[i].FinalTime === rt) {
        lanes[i].FinalTime = RT_SENTINEL;
      }
    }
  }

  // Replace RunningTime with =TICK when it increments by exactly +0.1s (mutates in place)
  // Returns the REAL tenths value for tracking across entries
  function sentinelizeClock(data, prevRealTenths) {
    if (!data || !data.swimming || !data.swimming.RunningTime) return prevRealTenths;
    var rtString = data.swimming.RunningTime;
    var tenths = parseRT(rtString);
    if (tenths === null) return prevRealTenths;
    if (prevRealTenths !== null && tenths === prevRealTenths + 1) {
      data.swimming.RunningTime = TICK_SENTINEL;
    }
    return tenths;
  }

  // Resolve =TICK sentinels in output clone, returning resolved tenths for chaining
  function resolveClockSentinels(state, prevResolvedTenths) {
    if (!state || !state.swimming) return prevResolvedTenths;
    if (state.swimming.RunningTime === TICK_SENTINEL) {
      var resolved = prevResolvedTenths + 1;
      state.swimming.RunningTime = formatRT(resolved);
      return resolved;
    }
    var tenths = parseRT(state.swimming.RunningTime);
    return tenths !== null ? tenths : prevResolvedTenths;
  }

  function compress(entries) {
    if (!entries || entries.length === 0) {
      return { version: 1, baseline: null, deltas: [] };
    }

    var sentineledBaseline = deepClone(entries[0].data);
    sentinelizeRT(sentineledBaseline);
    var prevRealTenths = sentinelizeClock(sentineledBaseline, null);

    var result = {
      version: 1,
      baseline: { t: entries[0].t, data: sentineledBaseline },
      deltas: []
    };

    var prevData = sentineledBaseline;

    for (var i = 1; i < entries.length; i++) {
      var sentineledCurr = deepClone(entries[i].data);
      sentinelizeRT(sentineledCurr);
      prevRealTenths = sentinelizeClock(sentineledCurr, prevRealTenths);
      var d = diff(prevData, sentineledCurr);
      var delta = { t: entries[i].t };
      if (d !== undefined) {
        delta.d = d;
      }
      result.deltas.push(delta);
      prevData = sentineledCurr;
    }

    // Build dictionary and remap keys
    var dictInfo = buildDict(result.baseline, result.deltas);
    result.dict = dictInfo.dict;
    result.baseline.data = remapKeys(result.baseline.data, dictInfo.map);
    for (var ri = 0; ri < result.deltas.length; ri++) {
      if (result.deltas[ri].d) {
        result.deltas[ri].d = remapKeys(result.deltas[ri].d, dictInfo.map);
      }
    }

    return result;
  }

  function decompress(compressed) {
    if (!compressed || !compressed.baseline) {
      return [];
    }

    // Build reverse map (short -> long) for key expansion
    var revMap = compressed.dict || {};

    var baselineData = remapKeys(deepClone(compressed.baseline.data), revMap);
    var state = baselineData;
    // Keep sentinels in live state; resolve on output clones
    var baselineOut = deepClone(state);
    var prevResolvedTenths = resolveClockSentinels(baselineOut, null);
    resolveRTSentinels(baselineOut);
    var entries = [{ t: compressed.baseline.t, data: baselineOut }];

    for (var i = 0; i < compressed.deltas.length; i++) {
      var delta = compressed.deltas[i];
      if (delta.d) {
        var expandedDelta = remapKeys(deepClone(delta.d), revMap);
        state = applyDelta(state, expandedDelta);
      }
      var out = deepClone(state);
      prevResolvedTenths = resolveClockSentinels(out, prevResolvedTenths);
      resolveRTSentinels(out);
      entries.push({ t: delta.t, data: out });
    }

    return entries;
  }

  // --- Key dictionary compression ---

  // Collect all non-numeric, non-special keys and their frequencies
  function collectKeys(obj, counts) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (var ai = 0; ai < obj.length; ai++) collectKeys(obj[ai], counts);
      return;
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === '__len') continue;
      if (/^\d+$/.test(k)) {
        collectKeys(obj[k], counts);
        continue;
      }
      counts[k] = (counts[k] || 0) + 1;
      collectKeys(obj[k], counts);
    }
  }

  // Generate a short code for a given index: 0-25 => a-z, 26+ => aa-zz
  function generateCode(index) {
    if (index < 26) {
      return String.fromCharCode(97 + index);
    }
    return String.fromCharCode(97 + Math.floor((index - 26) / 26)) +
      String.fromCharCode(97 + ((index - 26) % 26));
  }

  // Walk an object tree and assign dictionary codes for any new keys
  function assignNewCodes(obj, dict, map, codeCounter) {
    if (!obj || typeof obj !== 'object') return codeCounter;
    if (Array.isArray(obj)) {
      for (var ai = 0; ai < obj.length; ai++) {
        codeCounter = assignNewCodes(obj[ai], dict, map, codeCounter);
      }
      return codeCounter;
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === '__len') continue;
      if (/^\d+$/.test(k)) {
        codeCounter = assignNewCodes(obj[k], dict, map, codeCounter);
        continue;
      }
      if (!map.hasOwnProperty(k)) {
        var short = generateCode(codeCounter);
        if (short.length < k.length) {
          dict[short] = k;
          map[k] = short;
          codeCounter++;
        }
      }
      codeCounter = assignNewCodes(obj[k], dict, map, codeCounter);
    }
    return codeCounter;
  }

  function buildDict(baseline, deltas) {
    var counts = {};
    collectKeys(baseline.data, counts);
    for (var i = 0; i < deltas.length; i++) {
      if (deltas[i].d) collectKeys(deltas[i].d, counts);
    }

    // Sort by total bytes saved: frequency * keyLength, descending
    var keys = Object.keys(counts).sort(function (a, b) {
      return (counts[b] * b.length) - (counts[a] * a.length);
    });

    // Assign short codes a-z, then aa-zz
    var dict = {};   // short -> long
    var map = {};    // long -> short
    var code = 0;
    for (var ki = 0; ki < keys.length; ki++) {
      var short = generateCode(code);
      var long = keys[ki];
      // Only include if the code is actually shorter
      if (short.length < long.length) {
        dict[short] = long;
        map[long] = short;
        code++;
      }
    }
    return { dict: dict, map: map };
  }

  // Replace keys in an object tree using a long->short mapping
  function remapKeys(obj, map) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        obj[i] = remapKeys(obj[i], map);
      }
      return obj;
    }
    var out = {};
    var keys = Object.keys(obj);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      var newKey = map[k] || k;
      out[newKey] = remapKeys(obj[k], map);
    }
    return out;
  }

  // Serialize compressed object: one line per entry, like the original format
  function stringify(compressed) {
    var lines = [];
    lines.push('{"version":' + compressed.version + ',');
    if (compressed.dict) {
      lines.push('"dict":' + JSON.stringify(compressed.dict) + ',');
    }
    lines.push('"baseline":' + JSON.stringify(compressed.baseline) + ',');
    lines.push('"deltas":[');
    for (var i = 0; i < compressed.deltas.length; i++) {
      var sep = (i < compressed.deltas.length - 1) ? ',' : '';
      lines.push(JSON.stringify(compressed.deltas[i]) + sep);
    }
    lines.push(']}');
    return lines.join('\n');
  }

  // Incrementally add an entry to a compressed structure (for live logging)
  // Dictionary is built incrementally: new keys get codes as they're encountered
  function addEntry(compressed, t, data) {
    var sentineled = deepClone(data);
    sentinelizeRT(sentineled);

    if (compressed === null) {
      var prevRealTenths = sentinelizeClock(sentineled, null);
      var dict = {};   // short -> long
      var map = {};    // long -> short
      var codeCounter = assignNewCodes(sentineled, dict, map, 0);
      return {
        version: 1,
        baseline: { t: t, data: remapKeys(deepClone(sentineled), map) },
        deltas: [],
        _prevData: sentineled,
        _dict: dict,
        _map: map,
        _codeCounter: codeCounter,
        _prevRealTenths: prevRealTenths
      };
    }

    var prevRealTenths = sentinelizeClock(sentineled, compressed._prevRealTenths);
    var d = diff(compressed._prevData, sentineled);
    var delta = { t: t };
    if (d !== undefined) {
      compressed._codeCounter = assignNewCodes(d, compressed._dict, compressed._map, compressed._codeCounter);
      delta.d = remapKeys(d, compressed._map);
    }
    compressed.deltas.push(delta);
    compressed._prevData = sentineled;
    compressed._prevRealTenths = prevRealTenths;
    return compressed;
  }

  // Package for save: deep clone (already remapped) data, copy dict, strip transient fields
  function applyDict(compressed) {
    if (!compressed || !compressed.baseline) {
      return compressed;
    }

    var out = {
      version: compressed.version,
      baseline: deepClone(compressed.baseline),
      deltas: []
    };
    for (var i = 0; i < compressed.deltas.length; i++) {
      out.deltas.push(deepClone(compressed.deltas[i]));
    }

    if (compressed._dict && Object.keys(compressed._dict).length > 0) {
      out.dict = deepClone(compressed._dict);
    }

    return out;
  }

  var LogCompressor = { compress: compress, decompress: decompress, stringify: stringify, addEntry: addEntry, applyDict: applyDict };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogCompressor;
  }
  if (typeof window !== 'undefined') {
    window.LogCompressor = LogCompressor;
  }
})();
