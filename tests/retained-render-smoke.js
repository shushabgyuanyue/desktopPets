const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(require('node:os').tmpdir(),'deskAnts-retained-render-smoke'));
ipcMain.handle('desktop:icons',()=>[]);
ipcMain.handle('window:mouse-mode',()=>{});
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:800,height:600,show:false,
   webPreferences:{preload:path.join(__dirname,'..','preload.js'),sandbox:false,backgroundThrottling:false}});
 let failed=false;
 try{
  await window.loadFile(path.join(__dirname,'..','renderer','index.html'));
  window.webContents.send('desktop:visibility',true);
  await window.webContents.executeJavaScript(require('node:fs').readFileSync(path.join(__dirname,'fixtures','pheromone-reference.js'),'utf8'));
  const result=await window.webContents.executeJavaScript(`(() => {
    state.running=false;cancelAnimationFrame(state.frameId);state.frameId=null;
    clearInterval(state.tickTimer);clearInterval(state.iconTimer);
    const diff=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)n++;max=Math.max(d,max);}return {n,max};};
    const retained=document.createElement('canvas'),clean=document.createElement('canvas');
    const fast=window.AntSketchRenderer.createSketchAntRenderer(retained);
    const reference=window.AntSketchRenderer.createSketchAntRenderer(clean);
    fast.resize(640,400,1.25);reference.resize(640,400,1.25);
    const portal={mouth:{x:70,y:90},rect:{x:50,y:60,w:40,h:60}};
    const obstacles=[{x:120,y:90,w:38,h:38},{x:290,y:200,w:38,h:38}];
    let spriteDifference=0;
    for(let step=0;step<16;step++){
      if(step===8){fast.resize(400,250,2);reference.resize(400,250,2);}
      if(step===9){fast.resize(640,400,1.25);reference.resize(640,400,1.25);}
      const actors=step===15?[]:Array.from({length:36},(_,id)=>({id,
        x:50+(id%9)*60+step*3.1,y:65+Math.floor(id/9)*80,angle:id*.4+step*.08,
        carrying:id%4===0,payloadKind:'file',mode:id===3?'deposit':'search',
        entryProgress:id===3?step/15:0,departureProgress:id===4?step/15:1}));
      clean.getContext('2d').save();clean.getContext('2d').resetTransform();
      clean.getContext('2d').clearRect(0,0,800,500);clean.getContext('2d').restore();
      fast.render(actors,obstacles,step*16,true,portal);reference.render(actors,obstacles,step*16,true,portal);
      spriteDifference+=diff(retained.getContext('2d').getImageData(0,0,800,500).data,
        clean.getContext('2d').getImageData(0,0,800,500).data).n;
    }
    fast.dispose();reference.dispose();
    const exploration=Array.from({length:256},(_,i)=>({x:5+i%32*10,y:5+Math.floor(i/32)*10,strength:(i+.3)/256}));
    const food=exploration.map(p=>({...p,y:p.y+40}));
    state.colony={snapshot:()=>({explorationPheromone:exploration,pheromone:food})};
    releasePheromoneLayer();state.showPheromones=true;
    do{refreshPheromones(10000);}while(state.pheromoneWork);
    const optimizedLayer=state.pheromoneLayer;
    state.pheromoneLayer=null;state.pheromoneScratch=null;state.pheromoneWork=null;
    state.lastPheromoneCapture=0;
    do{referencePheromones(10000);}while(state.pheromoneWork);
    const old=state.pheromoneLayer,ink=old.getContext('2d');
    const a=ink.getImageData(0,0,old.width,old.height).data;
    const b=optimizedLayer.getContext('2d').getImageData(0,0,old.width,old.height).data;
    state.pheromoneLayer=optimizedLayer;
    let glowMax=0,glowTotal=0,glowChannels=0,glowWorst=null;
    for(let i=0;i<a.length;i+=4)if(a[i+3]||b[i+3])for(let c=0;c<3;c++){
      const d=Math.abs(a[i+c]*a[i+3]/255-b[i+c]*b[i+3]/255);
      if(d>glowMax)glowWorst={x:(i/4)%old.width,y:Math.floor(i/4/old.width),a:Array.from(a.slice(i,i+4)),b:Array.from(b.slice(i,i+4))};
      glowMax=Math.max(glowMax,d);glowTotal+=d;glowChannels++;
    }
    // Compare every partial repaint with a fresh full repaint of the same frame.
    state.snapshot={ants:[],elapsed:2,fileFoods:[]};state.desktopIcons=[];
    let mapDifference=0,mapMax=0;
    for(let step=0;step<10;step++){
      state.food=step===9?null:{x:150+step*13.7,y:70+step*4.1};
      draw(10010+step*16);
      const partial=context.getImageData(0,0,canvas.width,canvas.height).data;
      mapPaint=null;draw(10010+step*16);
      const d=diff(partial,context.getImageData(0,0,canvas.width,canvas.height).data);
      mapDifference+=d.n;mapMax=Math.max(mapMax,d.max);
    }
    return {spriteDifference,mapDifference,mapMax,glowMax,glowMean:glowTotal/glowChannels,
      glowWorst,lastStyle:ink.fillStyle,transform:ink.getTransform().toString(),glowBefore:old.toDataURL(),glowAfter:state.pheromoneLayer.toDataURL()};
  })()`);
  for(const key of ['glowBefore','glowAfter']) {
    require('node:fs').writeFileSync(path.join(__dirname,'..','diagnostics',key+'.png'),Buffer.from(result[key].split(',')[1],'base64'));
    delete result[key];
  }
  console.log(JSON.stringify(result));
  assert.equal(result.spriteDifference,0,'retained sprites must match full clears exactly, including empty frames');
  assert.ok(result.mapMax<=1,'cropped texture resampling may differ by one channel level, never visible seams');
  assert.ok(result.glowMax<5&&result.glowMean<.35,'cached glow must remain visually equivalent');
 }catch(e){console.error(e);failed=true;}
 finally{window.destroy();app.exit(failed?1:0);}
});
