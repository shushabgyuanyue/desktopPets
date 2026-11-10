// Same desktop-sized workload for before/after comparisons. No real files.
const {app,BrowserWindow,ipcMain,nativeImage}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const root=path.join(__dirname,'..');
const rendererDir=process.env.ANTS_BENCH_RENDERER || path.join(root,'renderer');
const label=process.env.ANTS_BENCH_LABEL || 'current';
const icons=Array.from({length:83},(_,id)=>({id:String(id),name:'Fixture '+id,
  x:18+(id%8)*63,y:20+Math.floor(id/8)*71,w:38,h:38,isRecycleBin:id===0,
  physicalX:Math.round((18+(id%8)*63)*1.25),physicalY:Math.round((20+Math.floor(id/8)*71)*1.25),
  physicalW:48,physicalH:48}));
ipcMain.handle('desktop:icons',()=>icons);
ipcMain.handle('window:mouse-mode',()=>{});
ipcMain.handle('desktop:wallpaper-patches',(_e,requests)=>requests.map(({id})=>({id,
  dataUrl:nativeImage.createFromBitmap(Buffer.from([45,40,36,255]),{width:1,height:1}).toDataURL()})));
app.setPath('userData',path.join(os.tmpdir(),'deskAnts-resource-benchmark'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function metrics(){return app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,
  privateMB:p.memory.privateBytes/1024,workingMB:p.memory.workingSetSize/1024,
  cpuPercent:p.cpu.percentCPUUsage}));}
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:1536,height:864,frame:false,show:false,transparent:true,
   webPreferences:{preload:path.join(root,'preload.js'),sandbox:false,backgroundThrottling:false}});
 try{
  await window.loadFile(path.join(rendererDir,'index.html'));
  window.webContents.send('desktop:visibility',true);await pause(250);
  await window.webContents.executeJavaScript(`(() => {
    cancelAnimationFrame(state.frameId);state.frameId=null;clearInterval(state.iconTimer);clearInterval(state.tickTimer);
    let seed=9183;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    state.food={x:1100,y:620};state.colony=createColony({width:state.width,height:state.height,gridSize:10,
      count:36,nest,food:state.food,obstacles:terrainObstacles(),random});
    for(let i=0;i<3600;i++)state.colony.step(.05);
    state.snapshot=snapshotForDisplay();state.lastTick=performance.now();
    window.bench={frames:0,times:{},fullClears:0,clearPixels:0};
    const wrap=(fn,key)=>function(...args){const t=performance.now();const result=fn.apply(this,args);
      bench.times[key]=(bench.times[key]||0)+performance.now()-t;return result;};
    draw=wrap(draw,'mapMs');state.antRenderer.render=wrap(state.antRenderer.render,'antsMs');
    refreshPheromones=wrap(refreshPheromones,'pheromoneMs');drawNest=wrap(drawNest,'portalMs');
    drawMantouIcons=wrap(drawMantouIcons,'foodMs');drawNestEntry=wrap(drawNestEntry,'entryMs');
    state.colony.step=wrap(state.colony.step,'simulationMs');
    state.colony.snapshot=wrap(state.colony.snapshot,'snapshotMs');
    updateMetrics=wrap(updateMetrics,'panelMs');
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(x,y,w,h){
      if(this.canvas===canvas||this.canvas===antCanvas){bench.clearPixels+=w*h;if(w>=state.width&&h>=state.height)bench.fullClears++;}
      return clear.call(this,x,y,w,h);};
    window.benchTimer=setInterval(()=>{frame(performance.now());cancelAnimationFrame(state.frameId);state.frameId=null;bench.frames++;},16);
  })()`);
  await pause(1000);
  await window.webContents.executeJavaScript('bench.frames=0;bench.times={};bench.fullClears=0;bench.clearPixels=0;true');
  const before=metrics(),start=Date.now();await pause(6000);const after=metrics();
  const data=await window.webContents.executeJavaScript(`(() => {clearInterval(benchTimer);
    return {...bench,elapsed:state.snapshot.elapsed,completedTrips:state.snapshot.completedTrips,
      renderer:state.antRenderer.stats(),heap:performance.memory?.usedJSHeapSize};})()`);
  const cpu=after;
  await window.webContents.executeJavaScript(`(() => {
    const original=frame;window.pauseFrames=0;
    frame=function(t){pauseFrames++;original(t);};
    document.getElementById('runBtn').click();requestFrame();
  })()`);
  await pause(1000);metrics();
  const pauseStart=await window.webContents.executeJavaScript('pauseFrames');
  await pause(3000);
  const paused=metrics();
  const pausedFrames=await window.webContents.executeJavaScript('pauseFrames')-pauseStart;
  window.webContents.send('desktop:visibility',false);await pause(1500);const hidden=metrics();
  const result={label,durationMs:6000,viewport:[1536,864,1.25],data,processes:cpu,paused,pausedFrames,hidden};
  const output=path.join(root,'diagnostics',`resources-${label}.json`);await fs.writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }catch(e){console.error(e);process.exitCode=1;}
 finally{window.destroy();app.exit(process.exitCode||0);}
});
