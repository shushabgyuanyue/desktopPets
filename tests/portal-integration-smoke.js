const {app,BrowserWindow,ipcMain,nativeImage} = require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
app.setPath('userData',path.join(os.tmpdir(),'deskAnts-portal-smoke'));
const icon={id:'bin',name:'回收站',isRecycleBin:true,x:70,y:90,w:64,h:72,
  physicalX:88,physicalY:113,physicalW:80,physicalH:90};
let patchCalls=0;
ipcMain.handle('desktop:icons',()=>[icon]);
ipcMain.handle('window:mouse-mode',()=>{});
ipcMain.handle('desktop:wallpaper-patches',(_event,requests)=>{
  patchCalls++;
  return requests.map(({id})=>({id,dataUrl:nativeImage.createFromBitmap(
    Buffer.from([231,240,242,255]),{width:1,height:1}).toDataURL()}));
});
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:640,height:400,show:false,frame:false,transparent:true,
    webPreferences:{preload:path.join(__dirname,'..','preload.js'),sandbox:false,contextIsolation:true,backgroundThrottling:false}});
  let failed=false;
  try {
    await window.loadFile(path.join(__dirname,'..','renderer','index.html'));
    window.webContents.send('desktop:visibility',true);
    async function waitPatch(){for(let i=0;i<60;i++){
      if(await window.webContents.executeJavaScript('state.portalBackdrop?.key === wallpaperPatchKey(state.recycleBin)'))return;
      await new Promise(r=>setTimeout(r,30));
    }throw Error('portal backdrop not ready');}
    await waitPatch();
    const first=await window.webContents.executeJavaScript(`(() => {
      state.running=false;cancelAnimationFrame(state.frameId);state.frameId=null;
      state.showPheromones=false;
      const p=state.entryPortal;
      const core=window.AntSketchRenderer;
      const start=core.portalPose({id:1,x:p.outside.x,y:p.outside.y,mode:'search',departureProgress:0},p);
      const end=core.portalPose({id:1,x:p.outside.x+25,y:p.outside.y,mode:'search',departureProgress:1},p);
      const incoming=core.portalPose({id:2,x:p.outside.x,y:p.outside.y,mode:'deposit',entryProgress:1},p);
      state.snapshot={...state.snapshot,elapsed:1,ants:[]};draw(1000);
      const pixels=()=>context.getImageData(Math.round(p.rect.x*state.dpr),Math.round(p.rect.y*state.dpr),
        Math.round(p.rect.w*state.dpr),Math.round(p.rect.h*state.dpr)).data;
      const a=pixels().slice();state.snapshot.elapsed=2;draw(2000);const b=pixels();
      let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1])changed++;
      const corner=Array.from(context.getImageData(Math.round((p.rect.x+1)*state.dpr),Math.round((p.rect.y+1)*state.dpr),1,1).data);
      const labelAlpha=context.getImageData(Math.round(p.mouth.x*state.dpr),Math.round((p.rect.y+p.rect.h+10)*state.dpr),1,1).data[3];
      const ant={id:3,x:p.outside.x,y:p.outside.y,angle:Math.PI/2,mode:'deposit',entryProgress:.68};
      state.antRenderer.render([ant],state.desktopIcons,2000,false,p);
      const ink=antCanvas.getContext('2d').getImageData(Math.round(p.rect.x*state.dpr),Math.round(p.rect.y*state.dpr),
        Math.round(p.rect.w*state.dpr),Math.round(p.rect.h*state.dpr)).data;
      let portalInk=0;for(let i=3;i<ink.length;i+=4)if(ink[i])portalInk++;
      return {start,end,incoming,changed,corner,labelAlpha,portalInk};
    })()`);
    icon.x+=140;icon.physicalX+=175;
    await window.webContents.executeJavaScript('syncDesktopIcons()');await waitPatch();
    const moved=await window.webContents.executeJavaScript('({x:state.entryPortal.rect.x,key:state.portalBackdrop.key})');
    console.log(JSON.stringify({first,moved,patchCalls}));
    failed=first.start.alpha!==0||first.start.x!==102||first.start.y!==126||first.end.x!==127||
      first.incoming.alpha!==0||first.changed<300||first.labelAlpha!==0||first.portalInk<30||
      first.corner[0]!==242||first.corner[1]!==240||first.corner[2]!==231||moved.x!==210||patchCalls!==2;
    // Export a quiet art sheet at actual desktop size and a magnified detail.
    const preview = await window.webContents.executeJavaScript(`(() => {
      panel.hidden=true;document.getElementById('mapToast').classList.remove('show');
      document.body.style.setProperty('background','#f2f0e7','important');
      const p=state.entryPortal;
      const actors=[{id:11,x:p.outside.x,y:p.outside.y,angle:Math.PI/2,mode:'deposit',entryProgress:.45,carrying:true,payloadKind:'file'},
        {id:12,x:p.outside.x+38,y:p.outside.y+5,angle:0,mode:'search',departureProgress:.65},
        {id:13,x:325,y:170,angle:-.2,action:'sniff',actionProgress:.3},
        {id:14,x:350,y:230,angle:-2.5,carrying:true,payloadKind:'file'}];
      state.snapshot={...state.snapshot,elapsed:2,ants:actors};draw(2000);
      state.antRenderer.render(actors,state.desktopIcons,2000,false,p);
      const label=document.createElement('div');label.textContent='回收站';label.style.cssText='position:fixed;left:219px;top:168px;color:#243b2d;font:12px sans-serif';
      document.body.append(label);
      const sheet=document.createElement('canvas');sheet.width=460;sheet.height=500;
      const ink=sheet.getContext('2d');ink.fillStyle='#f2f0e7';ink.fillRect(0,0,460,500);
      ink.scale(2,2);ink.translate(-190,-30);
      ink.drawImage(canvas,0,0,state.width,state.height);
      ink.drawImage(antCanvas,0,0,state.width,state.height);
      ink.fillStyle='#243b2d';ink.font='12px sans-serif';ink.fillText('回收站',224,177);
      return sheet.toDataURL();
    })()`);
    const output=path.join(__dirname,'..','docs','portal-art-preview.png');
    await fs.writeFile(output,Buffer.from(preview.split(',')[1],'base64'));console.log(JSON.stringify({output}));
  }catch(e){console.error(e);failed=true;}
  finally{window.destroy();app.exit(failed?1:0);}
});
