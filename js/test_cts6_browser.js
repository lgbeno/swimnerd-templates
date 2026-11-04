// Optional integration test. Requires Playwright and a running local HTTP server.
const { chromium }=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CTS6_CHROME ? {executablePath:process.env.CTS6_CHROME} : {})});
 try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.openOptions=[];window.closes=0;window.messages=[];
  Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>({
    open:async options=>{window.openOptions.push(options)},
    readable:new ReadableStream({start(controller){window.serialController=controller}}),
    close:async()=>{window.closes++}
  })}});
  const listener=new BroadcastChannel('swimnerd-scoreboard');listener.onmessage=e=>window.messages.push(e.data);
 });
 await page.goto(process.env.CTS6_URL || 'http://127.0.0.1:8873/CTS6.html');await page.locator('#connect').click();
 await page.waitForFunction(()=>document.querySelector('#sourceStatus').textContent.includes('Live serial'));
 assert.equal(await page.locator('#files').isDisabled(),true);
 await page.evaluate(()=>serialController.enqueue(Uint8Array.from([0xa6,0,0x18,0x2c,0x30,0x40,0x50,0x60,0x7e,0xbe,0x70,0x6f,0x5f,0x40,0x30,0x20,0xa8])));
 await page.waitForFunction(()=>document.querySelector('#event').textContent==='73 / 1');
 await page.evaluate(()=>serialController.enqueue(Uint8Array.from([0xbe,0x70,0x6e,0x5f,0x40,0x30,0x20,0xa8])));
 await page.locator('#publish').check();
 await page.waitForFunction(()=>messages.some(m=>m.swimming.ScoreboardCurrentState===3));
 await page.waitForFunction(()=>document.querySelector('#raceState').textContent==='UNKNOWN');
 await page.waitForFunction(()=>messages.at(-1).swimming.ScoreboardCurrentState===null);
 await page.locator('#disconnect').click();
 await page.waitForFunction(()=>closes===1);
 assert.equal(await page.locator('#publish').isChecked(),false);
 assert.equal(await page.locator('#files').isDisabled(),false);
 assert.deepEqual(await page.evaluate(()=>openOptions[0]),{baudRate:9600,dataBits:8,stopBits:1,parity:'even',flowControl:'none'});
 await page.locator('#connect').click();
 await page.waitForFunction(()=>document.querySelector('#event').textContent==='— / —');
 await page.evaluate(()=>serialController.error(new Error('Adapter removed')));
 await page.waitForFunction(()=>closes===2);
 assert((await page.locator('#error').textContent()).includes('Adapter removed'));
 assert.equal(await page.locator('#publish').isChecked(),false);assert.deepEqual(errors,[]);
 console.log('PASS mocked serial settings/read, publishing, stale-clock interlock, disconnect, fresh reconnect and device error');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
