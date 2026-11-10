// Run with Electron and a compiled desktop-probe.exe path. A short-lived test
// window verifies push notifications with NO recurring focus command.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const assert=require('node:assert/strict');
const executable=process.argv[2];
app.whenReady().then(async()=>{
  if(process.env.ANTS_FOREGROUND_FIXTURE==='1') {
    const other=new BrowserWindow({width:320,height:100,show:true,skipTaskbar:true});
    await other.loadURL('data:text/html,<body>Other application fixture</body>');
    other.show();other.focus();setTimeout(()=>app.exit(0),6000);return;
  }
  let probe,window,other;
  const events=[];
  const waitFor=async(expected)=>{
    const start=Date.now();
    while(Date.now()-start<4000){
      if(events.at(-1)?.line===expected)return Date.now()-start;
      await new Promise(r=>setTimeout(r,10));
    }
    throw Error(`No native event ${expected}: ${JSON.stringify(events)}`);
  };
  let failed=false;
  try{
    probe=spawn(executable,['-Watch','-ProcessId',String(process.pid)],{windowsHide:true});
    probe.on('error',error=>{console.error(error);app.exit(1);});
    probe.stderr.on('data',data=>process.stderr.write(data));
    readline.createInterface({input:probe.stdout}).on('line',line=>events.push({line,at:Date.now()}));
    window=new BrowserWindow({width:340,height:100,show:false,skipTaskbar:true});
    await window.loadURL('data:text/html,<body style="background:%23eef4df;font:16px sans-serif">Ant colony visibility check</body>');
    window.show();window.focus();
    probe.stdin.write('focus\n');await waitFor('focus:desktop');
    other=spawn(process.execPath,[__filename],{windowsHide:true,
      env:{...process.env,ANTS_FOREGROUND_FIXTURE:'1'}});
    const hideMs=await waitFor('focus:other');
    other.kill();
    window.show();window.focus();
    const showMs=await waitFor('focus:desktop');
    assert.ok(showMs<600,'Foreground notification should beat the removed 600ms delay');
    probe.stdin.end();
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Native watcher did not exit on stdin EOF')),2000);
      probe.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Exit ${code}`));});
    });
    console.log(JSON.stringify({showMs,hideMs,events,cleanExit:true}));
  }catch(error){
    console.error(error);console.error('own focus:',window?.isFocused());
    probe?.stdin.write('focus\n');await new Promise(r=>setTimeout(r,100));
    console.error('after explicit focus poll:',events);failed=true;
  }
  finally{window?.destroy();other?.kill();probe?.kill();app.exit(failed?1:0);}
});
