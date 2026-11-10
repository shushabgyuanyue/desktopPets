const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', path.join(os.tmpdir(), 'deskAnts-performance-smoke'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false, width:640, height:480,
    webPreferences:{backgroundThrottling:false}});
  let failed = false;
  try {
    await window.loadFile(path.join(__dirname, 'sketch-render-smoke.html'));
    const result = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.getElementById('ants');
      const renderer = createSketchAntRenderer(canvas);
      renderer.resize(640,480,1.25);
      const ants = [{id:1,x:120,y:120,angle:0,mode:'search'},
        {id:2,x:142,y:120,angle:Math.PI,mode:'search'}];
      const original = JSON.stringify(ants);
      renderer.render(ants,[],0,true);
      const firstGreetings = renderer.stats().greetings;
      for(let i=1;i<=120;i++) renderer.render(ants,[],i*16,true);
      const laterGreetings = renderer.stats().greetings;
      const unmodified = JSON.stringify(ants) === original;
      const carrier = [{id:9,x:160,y:160,angle:0,carrying:true,payloadKind:'file'}];
      renderer.render(carrier,[],2000,true);
      renderer.render(carrier,[],2100,false);
      const paused = canvas.toDataURL();
      renderer.render(carrier,[],2600,false);
      const pauseStable = canvas.toDataURL() === paused;
      const pixels = [];
      for(let i=0;i<16;i++) {
        renderer.render([{id:10,x:200,y:180,angle:0,action:'cutting',actionProgress:i/16}],[],3000+i*16,true);
        pixels.push(canvas.toDataURL());
      }
      const cuttingFrames = new Set(pixels).size;
      const stats = renderer.stats();
      renderer.setVisible(false);
      const hidden = canvas.width === 1 && canvas.height === 1;
      renderer.setVisible(true);
      renderer.render(carrier,[],9000,true);
      const atlasReused = stats.atlasBuilds === renderer.stats().atlasBuilds;
      renderer.dispose();
      return {firstGreetings,laterGreetings,unmodified,pauseStable,cuttingFrames,hidden,atlasReused,atlasBytes:stats.atlasBytes};
    })()`);
    console.log(JSON.stringify(result));
    failed = result.firstGreetings !== 1 || result.laterGreetings !== 1 ||
      !result.unmodified || !result.pauseStable || result.cuttingFrames < 5 ||
      !result.hidden || !result.atlasReused || result.atlasBytes > 700000;
  } catch(error) {console.error(error);failed=true;}
  finally {window.destroy();app.exit(failed?1:0);}
});
