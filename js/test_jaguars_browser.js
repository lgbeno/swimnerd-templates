/* Start the repository HTTP server on port 8873 before running.
   NODE_PATH may point to your Playwright installation; CHROME_PATH is optional. */
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:1080}});
        const errors = [], sockets = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('websocket', socket => sockets.push(socket.url()));
        await page.addInitScript(() => {
            window.channelCount = 0;
            const Original = window.BroadcastChannel;
            window.BroadcastChannel = class extends Original {constructor(...args){super(...args);window.channelCount++;}};
        });
        await page.goto('http://127.0.0.1:8873/themes/jaguars/Preview.html');
        await page.waitForFunction(() => document.querySelectorAll('.team').length === 13);
        await page.waitForTimeout(800);
        const lanes = page.frames().find(frame => frame.url().includes('/LaneOverlay.html'));
        const timer = page.frames().find(frame => frame.url().includes('/TimerOverlay.html'));
        assert.equal(await lanes.locator('.lanes-container .lineup-content.visible').count(),8);
        assert.equal(await lanes.locator('#lineupTeam-1').textContent(),'Ashwaubenon');
        await page.click('#race');
        await page.waitForTimeout(600);
        assert.equal(await lanes.locator('.lanes-container .lineup-content.visible').count(),0);
        assert.equal(await timer.locator('#timerContent').getAttribute('class'),'timer-content visible');
        await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Finish'),null,{timeout:20000});
        await page.waitForTimeout(400);
        assert.equal(await lanes.locator('.lane-content.visible').count(),8);
        assert.equal(await lanes.locator('#finalTime-4').textContent(),'54.72');
        assert.equal(await lanes.locator('#resultTeam-4').textContent(),'Marinette/Peshtigo');
        assert.equal(await timer.locator('#timerContent.visible').count(),0);
        await page.click('#lineup'); await page.waitForTimeout(800);
        assert.equal(await lanes.locator('.lane-content.visible').count(),0);
        assert.equal(await lanes.locator('.lanes-container .lineup-content.visible').count(),8);
        await page.click('#next'); await page.waitForTimeout(500);
        assert.equal(await lanes.locator('#lineupTeam-2').textContent(),'Sturgeon Bay/Sevastopol/Southern Door');
        await page.evaluate(() => clearInterval(previewInterval));
        // Inject a local fixture directly into the preview adapter, never a live channel.
        await lanes.evaluate(() => {
            const fixture = {swimming:{EventNumber:'99',HeatNumber:'1',ScoreboardCurrentState:0,LaneAthleteTeam:Array.from({length:10},(_,i)=>({LaneNumber:i<8?String(i+1):'',AthleteName:i<8?'Long Swimmer Name Example':'',Team:i===0?'Milwaukee Pulaski':i===1?'Two Rivers/Ronc':'',SplitTime:'',FinalTime:'',Place:''}))}};
            previewReceive(fixture);
        });
        assert.equal(await lanes.locator('#lineupTeam-1').textContent(),'Milwaukee Pulaski');
        assert.equal(await lanes.locator('#lane-1').evaluate(el=>el.style.getPropertyValue('--team-primary')),'#394c44');
        assert.equal(await lanes.locator('#lineupTeam-2').textContent(),'Two Rivers/Roncalli');
        assert.deepEqual(sockets,[], 'Preview must never connect to the live feed');
        for(const frame of page.frames()) assert.equal(await frame.evaluate(()=>window.channelCount),0,'Preview must not publish demo data');
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
        assert.deepEqual(errors,[]);
        // Live composition must remain transparent, and use live iframe URLs.
        const live = await browser.newPage({viewport:{width:1920,height:1080}});
        await live.routeWebSocket('ws://localhost:8080/',()=>{});
        await live.goto('http://127.0.0.1:8873/themes/jaguars/BroadcastOverlay.html');
        assert.equal(await live.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
        assert.equal(await live.locator('iframe').count(),3);
        for(const src of await live.locator('iframe').evaluateAll(frames=>frames.map(frame=>frame.src))) assert.ok(!src.includes('preview'));
        console.log('Jaguars browser checks passed: isolated preview, lineup/race/results/reset, team aliases, unknown fallback, mobile layout, transparent OBS source.');
    } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
