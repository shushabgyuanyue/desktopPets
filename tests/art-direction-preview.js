// Self-contained art QA; no real files, recycling or desktop icon mutations.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
app.setPath('userData',path.join(os.tmpdir(),'deskAnts-art-preview'));
ipcMain.handle('desktop:icons',()=>[]);
ipcMain.handle('window:mouse-mode',()=>{});
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:900,height:540,frame:false,show:false,
    webPreferences:{preload:path.join(__dirname,'..','preload.js'),sandbox:false,backgroundThrottling:false}});
  try{
    await window.loadFile(path.join(__dirname,'..','renderer','index.html'));
    window.webContents.send('desktop:visibility',true);
    const output=await window.webContents.executeJavaScript(`(() => {
      state.running=false;cancelAnimationFrame(state.frameId);state.frameId=null;
      document.body.style.setProperty('background','#e9eedc','important');
      const sheet=document.createElement('canvas');sheet.width=560;sheet.height=490;
      sheet.style.cssText='position:fixed;left:12px;top:20px;width:560px;height:490px;z-index:3';
      document.body.append(sheet);
      const c=sheet.getContext('2d');c.fillStyle='#e9eedc';c.fillRect(0,0,560,490);
      const core=window.AntSketchRenderer;
      c.fillStyle='#253a2c';c.font='bold 21px sans-serif';c.fillText('蚁群 · 星际点心局',20,32);
      c.font='12px sans-serif';c.fillText('传送膜持续起伏  /  两位特别来客  /  前足举食',20,58);
      const stage=document.createElement('canvas');const r=core.createSketchAntRenderer(stage);r.resize(260,80,2);
      const actors=[{id:0,x:40,y:40,angle:0,action:'sniff',actionProgress:.15},
        {id:1,x:120,y:40,angle:0,carrying:true,payloadKind:'file'},
        {id:2,x:205,y:40,angle:0,carrying:true,payloadKind:'food'}];
      r.render(actors,[],1000,false);
      c.drawImage(stage,0,0,stage.width,stage.height,15,85,520,160);
      c.fillText('护目镜科学家',46,240);c.fillText('披风探险家',211,240);c.fillText('普通搬运工',390,240);
      const patch=document.createElement('canvas');patch.width=70;patch.height=80;
      const patchInk=patch.getContext('2d');patchInk.fillStyle='#e9eedc';patchInk.fillRect(0,0,70,80);
      for(let i=0;i<4;i++) {
        core.drawPortalIcon(c,{x:24+i*130,y:270,w:70,h:80},i*750,patch);
        c.fillStyle='#425644';c.fillText((i*.75).toFixed(2)+' s',40+i*130,370);
        core.drawMantouIcon(c,{x:30+i*130,y:399,w:64,h:64},0,'#e9eedc',[1,.75,.5,.25][i]);
      }
      r.dispose();return sheet.toDataURL();
    })()`);
    await fs.writeFile(path.join(__dirname,'..','docs','space-pet-art.png'),Buffer.from(output.split(',')[1],'base64'));
    await new Promise(r=>setTimeout(r,150));
    await window.webContents.capturePage();
    const page=await window.webContents.capturePage();
    await fs.writeFile(path.join(__dirname,'..','docs','space-pet-panel.png'),page.toPNG());
    window.setSize(390,700);
    const layout=await window.webContents.executeJavaScript(`(() => {
      const p=panel.getBoundingClientRect();
      const style=getComputedStyle(panel);
      return {x:p.x,right:p.right,width:innerWidth,background:style.backgroundColor,blur:style.backdropFilter};
    })()`);
    if(layout.x<0||layout.right>layout.width)throw Error('Panel overflows narrow viewport');
    console.log(JSON.stringify({layout,preview:'docs/space-pet-panel.png'}));
  }catch(error){console.error(error);app.exit(1);return;}
  finally{window.destroy();}
  app.exit(0);
});
