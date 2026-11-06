/* School color families verified against WIAA directory; hex values are broadcast
   interpretations. Co-ops use their lead school's palette. See README.md. */
(function (root) {
    const teams = [
        ['ashwaubenon', 'Ashwaubenon', 'Jaguars', '#174b35', '#e8b949', 20, []],
        ['antigo', 'Antigo', 'Red Robins', '#791c39', '#ffffff', 11, []],
        ['clintonville', 'Clintonville', 'Truckers', '#98400d', '#181818', 77, []],
        ['marinette', 'Marinette/Peshtigo', 'Marines', '#5c287b', '#ffffff', 229, ['Marinette/Peshti', 'Marinette']],
        ['new-london', 'New London', 'Bulldogs', '#a32032', '#ffffff', 294, []],
        ['notre-dame', 'Notre Dame/Green Bay N.E.W. Lutheran', 'Tritons', '#204ba0', '#38a65a', 306, ['Notre Dame/N.E.W. Lutheran', 'Notre Dame/N.E.W', 'Notre Dame']],
        ['pulaski', 'Pulaski', 'Red Raiders', '#b02331', '#ffffff', 352, []],
        ['shawano', 'Shawano/Bonduel', 'Hawks', '#a12332', '#151515', 388, ['Shawano']],
        ['seymour', 'Seymour/Freedom', 'Thunder', '#a61f32', '#ffffff', 387, ['Seymour']],
        ['sturgeon-bay', 'Sturgeon Bay/Sevastopol/Southern Door', 'Clippers', '#a12035', '#ffffff', 416, ['Sturgeon Bay Co-op', 'Sturgeon Bay']],
        ['two-rivers', 'Two Rivers/Roncalli', 'Purple Raiders', '#57277b', '#e8bc42', 432, ['Two Rivers/Ronc', 'Two Rivers']],
        ['wausau-east', 'Wausau East', 'Lumberjacks', '#a62032', '#ffffff', 454, []],
        ['wittenberg', 'Wittenberg-Birnamwood', 'Chargers', '#225637', '#e8bc42', 491, ['Witt-Birn', 'Wittenberg Birnamwood']]
    ].map(([id, name, mascot, primary, secondary, orgID, aliases]) => ({id, name, mascot, primary, secondary, orgID, aliases}));
    const normalize = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
    const lookup = new Map();
    for (const team of teams) for (const name of [team.name, ...team.aliases]) lookup.set(normalize(name), team);
    // Add exact Meet Manager codes here after checking the actual meet export.
    // Example: { 'YOUR_CODE': 'ashwaubenon' }. No guessing or substring matching.
    const codeAliases = {};
    for (const [code, id] of Object.entries(codeAliases)) {
        const team = teams.find(item => item.id === id);
        if (team) lookup.set(normalize(code), team);
    }
    const api = {teams, normalize, match: value => lookup.get(normalize(value)) || null};
    root.JaguarTeams = api;
    if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
