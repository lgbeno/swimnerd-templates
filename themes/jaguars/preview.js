// Intentionally isolated from the live BroadcastChannel and WebSocket feeds.
const scene = document.querySelector('.scene');
new ResizeObserver(([entry]) => {scene.style.transform = `scale(${entry.contentRect.width / 1920})`;}).observe(document.querySelector('.stage'));
for (const team of JaguarTeams.teams) {
    const card = document.createElement('article');
    card.className = 'team' + (team.id === 'ashwaubenon' ? ' host' : '');
    card.style.setProperty('--primary', team.primary);
    card.style.setProperty('--secondary', team.secondary);
    const name = document.createElement('strong'); name.textContent = team.name;
    const detail = document.createElement('small');
    const swatch = document.createElement('i'); detail.append(swatch, document.createTextNode(team.mascot + (team.id === 'ashwaubenon' ? ' · HOST' : '')));
    card.append(name, detail); document.getElementById('teams').append(card);
}
let offset = 0, heat = 1, started = null, completed = false;
const demoNames = ['A. SAMPLE', 'B. EXAMPLE', 'C. SAMPLE', 'D. EXAMPLE', 'E. SAMPLE', 'F. EXAMPLE', 'G. SAMPLE', 'H. EXAMPLE'];
function reset() { started = null; completed = false; heat++; }
document.getElementById('lineup').onclick = reset;
document.getElementById('next').onclick = () => {offset = (offset + 8) % JaguarTeams.teams.length; reset();};
document.getElementById('race').onclick = () => {if (started !== null && !completed) return; reset(); started = performance.now();};
document.getElementById('background').onchange = event => scene.classList.toggle('dark', event.target.value === 'dark');
function render() {
    const elapsed = started === null ? 0 : (performance.now() - started) / 1000;
    completed = started !== null && elapsed >= 15;
    const racing = started !== null && !completed;
    const lanes = Array.from({length:10}, (_, i) => ({
        LaneNumber: i < 8 ? String(i+1) : '', AthleteName: i < 8 ? demoNames[i] : '',
        Team: i < 8 ? JaguarTeams.teams[(offset+i)%13].name : '',
        Place: i < 8 && completed ? String([4,2,6,1,3,7,5,8][i]) : '',
        FinalTime: i < 8 && completed ? ['56.42','55.08','58.36','54.72','55.63','59.11','57.05','1:00.24'][i] : '',
        SplitTime: i < 8 && racing && elapsed > 5 ? '26.42' : ''
    }));
    document.getElementById('broadcast').contentWindow.previewReceive?.({swimming:{EventNumber:'7',HeatNumber:String(heat),EventName:'Girls 100 Yard Freestyle',ScoreboardCurrentState:racing?3:0,RunningTime:`0:${(elapsed*3.7).toFixed(1).padStart(4,'0')}`,LaneAthleteTeam:lanes}});
    document.getElementById('status').textContent = completed ? 'Finish · Results stay visible until the next heat' : racing ? 'Race demo · Lineups clear; only timing data appears' : 'Starting lineup · Ready for the next race';
    document.getElementById('race').disabled = racing;
}
const previewInterval = setInterval(render, 100);
