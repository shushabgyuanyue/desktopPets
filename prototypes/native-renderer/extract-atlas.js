const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setPath('userData', path.join(require('node:os').tmpdir(), 'deskAnts-native-atlas'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 38, height: 38, show: false,
    webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadFile(path.join(__dirname, 'extract-atlas.html'));
    const sheets = await window.webContents.executeJavaScript(`(() => {
      const cell=38, sheet=document.createElement('canvas');sheet.width=cell*8;sheet.height=cell*9;
      const out=sheet.getContext('2d');
      for(let row=0;row<9;row++)for(let phase=0;phase<8;phase++){
        const canvas=document.getElementById('ant'),ctx=canvas.getContext('2d');
        ctx.clearRect(0,0,cell,cell);
        const renderer=window.AntSketchRenderer.createSketchAntRenderer(canvas);
        const ant={id:(phase*7)%8,x:19,y:19,angle:0};
        if(row===0)ant.motionX=18;
        if(row===1||row===8){ant.carrying=true;ant.payloadKind='food';}
        if(row===2){ant.carrying=true;ant.payloadKind='file';}
        if(row===3){ant.action='sniff';ant.actionProgress=phase/8;ant.actionFacing=0;}
        if(row===4){ant.action='cutting';ant.actionProgress=.15+(phase/8)*(.7/3);}
        if(row===5){ant.action='alert';ant.actionProgress=phase/8;}
        if(row===6)ant.motionX=19;
        if(row===8){ant.mode='deposit';ant.entryProgress=.7+(phase%3)*.08;ant.x=25;}
        const portal={mouth:{x:34,y:19},rect:{x:26,y:0,w:12,h:38}};
        renderer.render([ant],[],phase*16,true,portal);
        out.drawImage(canvas,phase*cell,row*cell);
        renderer.dispose();
      }
      const portalCell=64,portal=document.createElement('canvas');portal.width=portalCell*12;portal.height=portalCell;
      const portalInk=portal.getContext('2d'),transparent=document.createElement('canvas');transparent.width=transparent.height=1;
      for(let i=0;i<12;i++)window.AntSketchRenderer.drawPortalIcon(portalInk,{x:i*portalCell,y:0,w:portalCell,h:portalCell},i*100,transparent);
      const snackCell=64,snack=document.createElement('canvas');snack.width=snackCell*8;snack.height=snackCell;
      const snackInk=snack.getContext('2d');for(let i=0;i<8;i++)window.AntSketchRenderer.drawSpaceSnack(snackInk,i*snackCell+32,32,56,i*100);
      return {ants:sheet.toDataURL('image/png'),portal:portal.toDataURL('image/png'),snack:snack.toDataURL('image/png')};
    })()`);
    for (const [name, dataUrl] of Object.entries(sheets))
      fs.writeFileSync(path.join(__dirname, 'assets', name + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('Exported the production ant, portal, and food artwork for the isolated native preview.');
  } catch (error) {
    console.error(error); app.exit(1); return;
  }
  window.destroy(); app.exit(0);
});
