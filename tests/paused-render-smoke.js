const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(require('node:os').tmpdir(),'deskAnts-paused-render-smoke'));
ipcMain.handle('desktop:icons',()=>[]);
ipcMain.handle('window:mouse-mode',()=>{});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:700,height:500,show:false,
   webPreferences:{preload:path.join(__dirname,'..','preload.js'),sandbox:false,backgroundThrottling:false}});
 let failed=false;
 try{
  await window.loadFile(path.join(__dirname,'..','renderer','index.html'));
  window.webContents.send('desktop:visibility',true);await pause(150);
  await window.webContents.executeJavaScript(`(() => {
    document.getElementById('runBtn').click();window.pauseDraws=0;
    const original=draw;draw=function(t){pauseDraws++;original(t);};
  })()`);
  for(let i=0;i<60;i++){
    if(await window.webContents.executeJavaScript('state.frameId===null&&!state.pheromoneWork'))break;
    await pause(50);
  }
  const before=await window.webContents.executeJavaScript('({frames:pauseDraws,time:state.snapshot.elapsed})');
  await pause(550);
  const settled=await window.webContents.executeJavaScript('({frames:pauseDraws,time:state.snapshot.elapsed,pending:state.frameId})');
  assert.equal(settled.frames,before.frames);assert.equal(settled.time,before.time);assert.equal(settled.pending,null);
  await window.webContents.executeJavaScript('state.food={x:350,y:180};setTerrain({food:state.food});true');
  await pause(600);
  const edited=await window.webContents.executeJavaScript('pauseDraws');assert.ok(edited>settled.frames);
  await window.webContents.executeJavaScript("document.getElementById('resetBtn').click();true");
  await pause(600);
  assert.equal(await window.webContents.executeJavaScript('state.food===null'),true);
  await window.webContents.executeJavaScript("document.getElementById('runBtn').click();true");
  await pause(600);
  const resumed=await window.webContents.executeJavaScript('({running:state.running,time:state.snapshot.elapsed,pending:state.frameId!==null})');
  assert.ok(resumed.running&&resumed.pending&&resumed.time>settled.time);
  console.log(JSON.stringify({before,settled,edited,resumed}));
 }catch(e){console.error(e);failed=true;}
 finally{window.destroy();app.exit(failed?1:0);}
});
