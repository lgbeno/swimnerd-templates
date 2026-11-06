/** Keep shared timing/state logic intact; add school identity to each lane. */
function processJaguarLanes(data) {
    processLaneData(data);
    for (let index = 0; index < SwimOverlay.numLanes; index++) {
        const lane = data.swimming.LaneAthleteTeam[index];
        const number = index + 1;
        const team = JaguarTeams.match(lane.Team);
        const row = document.getElementById(`lane-${number}`);
        row.style.setProperty('--team-primary', team ? team.primary : '#394c44');
        row.style.setProperty('--team-secondary', team ? team.secondary : '#bdc7c1');
        // Preserve unknown names; mapped co-ops keep all partner schools visible.
        const label = team ? team.name : (lane.Team || '');
        const lineup = document.getElementById(`lineupTeam-${number}`);
        if (lineup.textContent) lineup.textContent = label;
        const result = document.getElementById(`resultTeam-${number}`);
        result.textContent = label;
        result.hidden = !label;
        for (const element of [lineup, result]) {
            element.title = label;
            element.style.fontSize = '14px';
        }
    }
}
