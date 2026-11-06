const assert = require('node:assert/strict');
const {teams,match}=require('../themes/jaguars/teams.js');
assert.equal(teams.length,13);
assert.equal(new Set(teams.map(team=>team.id)).size,13);
for(const team of teams) {
    assert.equal(match(team.name.toUpperCase()),team);
    for(const alias of team.aliases) assert.equal(match(alias),team);
    assert.match(team.primary,/^#[0-9a-f]{6}$/i);
}
assert.equal(match('  Wittenberg — Birnamwood  ').id,'wittenberg');
assert.equal(match('Notre Dame/N.E.W').id,'notre-dame');
assert.equal(match('Marinette/Peshti').id,'marinette');
assert.equal(match('Milwaukee Pulaski'),null);
assert.equal(match('East'),null);
assert.equal(match('Unknown Team'),null);
assert.equal(match(null),null);
assert.equal(match(''),null);
console.log('Jaguars: 13 teams, verified aliases, punctuation normalization, and safe unknown-team fallback passed.');
