// Exercise actual Electron minimize/restore semantics, not just a mocked flag.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
ipcMain.handle('desktop:icons',()=>[]);
ipcMain.handle('window:mouse-mode',()=>{});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:700,height:460,show:false,transparent:true,
    webPreferences:{preload:path.join(root,'preload.js'),sandbox:false,backgroundThrottling:false}});
  const sandbox=vm.createContext({__dirname:root,process,console,setInterval,clearInterval,setTimeout,clearTimeout,
    require:name=>name==='electron'?{app:{requestSingleInstanceLock:()=>false,quit:()=>{},on:()=>{}},
      screen:{getCursorScreenPoint:()=>({x:10,y:10})}}:require(name)});
  let failed=false;
  try{
    vm.runInContext(fs.readFileSync(path.join(root,'main.js'),'utf8'),sandbox);
    await window.loadFile(path.join(root,'renderer','index.html'));
    sandbox.fixture=window;
    vm.runInContext('mainWindow=fixture;windowLoaded=true;desktopFocused=true;updateVisibility()',sandbox);
    await pause(100);
    window.minimize();
    for(let i=0;i<30&&!window.isMinimized();i++)await pause(20);
    assert.equal(window.isMinimized(),true,'fixture must reproduce a shell minimize');
    const before={visible:window.isVisible(),minimized:window.isMinimized()};
    vm.runInContext('updateVisibility()',sandbox);
    await pause(100);
    assert.equal(window.isMinimized(),false,'a native minimize must recover without a click');
    assert.equal(window.isVisible(),true);
    assert.equal(window.isFocusable(),true);
    const rendered=await window.webContents.executeJavaScript(`({visible:state.visible,
      hasAnts:state.snapshot?.ants.length,backing:[antCanvas.width,antCanvas.height],
      pending:state.frameId!==null})`);
    assert.equal(rendered.visible,true);assert.ok(rendered.hasAnts>0);
    assert.ok(rendered.backing.every(n=>n>1));assert.equal(rendered.pending,true);
    console.log(JSON.stringify({before,after:{visible:window.isVisible(),minimized:window.isMinimized()},rendered}));
  }catch(error){console.error(error);failed=true;}
  finally{vm.runInContext('stopCursorSync()',sandbox);window.destroy();app.exit(failed?1:0);}
});
