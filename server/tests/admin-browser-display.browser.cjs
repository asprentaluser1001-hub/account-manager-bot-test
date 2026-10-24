const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const requireApp=createRequire(require('node:path').join(__dirname,'..','package.json'));
process.env.ADMIN_PASSWORD='test-admin-secret-must-not-reach-browser';
process.env.JWT_SECRET='test-jwt-secret-must-not-reach-browser';
const {chromium}=requireApp('playwright');
const original=chromium.launchPersistentContext.bind(chromium);
const childProcess=require('node:child_process');
const originalSpawn=childProcess.spawn,desktopChildren=[];
childProcess.spawn=(command,...args)=>{
 const child=originalSpawn(command,...args);
 if(command==='Xvfb'||command==='dbus-daemon')desktopChildren.push(child);
 return child;
};
let openedProfile,remotePage,launchFailure;
chromium.launchPersistentContext=async(profile,options)=>{
 assert.equal(options.headless,false);
 assert.match(options.env.DISPLAY,/^:\d+$/);
 assert.match(options.env.DBUS_SESSION_BUS_ADDRESS,/^unix:path=/);
 assert.ok(options.env.DBUS_SESSION_BUS_ADDRESS.includes(profile+'/'));
 assert.equal(options.env.ADMIN_PASSWORD,undefined);
 assert.equal(options.env.JWT_SECRET,undefined);
 openedProfile=profile;
 let context;
 try {
  context=await original(profile,{...options,...(process.env.BROWSER_TEST_EXECUTABLE?{executablePath:process.env.BROWSER_TEST_EXECUTABLE}:{})});
 } catch (error) {
  // Capture only browser launch errors, before any website or human input.
  // The production viewer deliberately hides these details from its page.
  launchFailure=String(error.message || error).slice(0,8000);
  throw error;
 }
 const page=context.pages()[0]||await context.newPage();remotePage=page;
 const goto=page.goto.bind(page);
 page.goto=async(...args)=>{
  await page.route('https://flingster.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Local headed browser fixture</title><h1>VPS browser test</h1><input id="field">'}));
  return goto(...args);
 };
 return context;
};
const {AdminBrowser}=requireApp('./dist/lib/adminBrowser.js');
(async()=>{
 const manager=new AdminBrowser(),{id}=manager.start('fixture');
 try{
  let status;
  // The viewer launcher allows 60 seconds, and desktop/setup/cleanup add time.
  // The old 15-second observer cancelled a still-opening browser and hid the
  // actual launch result on a slower VPS. Allow the launcher to finish first.
  const deadline=Date.now()+100_000;
  while(Date.now()<deadline){
   status=manager.status('fixture',id);
   if(status.state==='ready'||status.state==='closed')break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(status.state,'ready',JSON.stringify(status));
  assert.equal(status.httpStatus,200);
  const frame=await manager.frame('fixture',id);
  assert.ok(frame.length>1000);
  const box=await remotePage.locator('#field').boundingBox();
  await manager.action('fixture',id,{type:'click',x:box.x+box.width/2,y:box.y+box.height/2});
  await manager.action('fixture',id,{type:'text',text:'manual-fixture-text'});
  assert.equal(await remotePage.locator('#field').inputValue(),'manual-fixture-text');
  console.log('Actual Xvfb + headed Chromium fixture passed. Frame bytes:',frame.length);
 }finally{
  await manager.stop('fixture',id);
  if(openedProfile)assert.equal(require('node:fs').existsSync(openedProfile),false);
  assert.ok(desktopChildren.every(child=>child.exitCode!==null||child.signalCode!==null));
 }
 assert.equal(manager.status('fixture',id).state,'closed');
 assert.equal(desktopChildren.length,2);
 console.log('Display, private desktop bus and browser cleanup completed; no external website requested.');
})().catch(e=>{
 console.error(e.message);
 if(launchFailure)console.error('Headed Chromium launch error (before loading any website):\n'+launchFailure);
 process.exitCode=1;
});
