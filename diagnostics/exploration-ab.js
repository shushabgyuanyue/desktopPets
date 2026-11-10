// Algorithm-only experiments; never touches or recycles desktop files.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, 'colony-before-exploration-fix.js'), 'utf8');
const icons = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, '..', 'desktop-icons.ps1')], {encoding:'utf8'}));
const scale = icons[0].dpiScale;
const screen = JSON.parse(execFileSync('powershell.exe', ['-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select-Object Width,Height | ConvertTo-Json'], {encoding:'utf8'}));
const desktop = {width:screen.Width/scale,height:screen.Height/scale,nest:{x:82,y:37.6},obstacles:icons.filter(i=>!i.isRecycleBin).map(i=>i.imageRect||i)};
fs.writeFileSync(path.join(__dirname, 'desktop-geometry.json'), JSON.stringify(desktop, null, 2));
const seeds = Number(process.argv[2]) || 4;
const only = process.argv[3]?.split(',');
const variants = {
  current: null,
  before: [],
  turn: [['ant.searchBudget = searchBudget(ant);','ant.searchBudget = searchBudget(ant); ant.angle += Math.PI / 2;']],
  persistent3: [['const EXPLORATION_RADIUS_BIAS = 0.35;', 'const EXPLORATION_RADIUS_BIAS = 0;'],['const EXPLORATION_PERSISTENCE = 1.3;','const EXPLORATION_PERSISTENCE = 3;']],
  persistent5: [['const EXPLORATION_RADIUS_BIAS = 0.35;', 'const EXPLORATION_RADIUS_BIAS = 0;'],['const EXPLORATION_PERSISTENCE = 1.3;','const EXPLORATION_PERSISTENCE = 5;']],
  persistent7: [['const EXPLORATION_RADIUS_BIAS = 0.35;', 'const EXPLORATION_RADIUS_BIAS = 0;'],['const EXPLORATION_PERSISTENCE = 1.3;','const EXPLORATION_PERSISTENCE = 7;']],
  radialTaper: [['Math.exp(radialProgress * EXPLORATION_RADIUS_BIAS)', 'Math.exp(radialProgress * EXPLORATION_RADIUS_BIAS * Math.max(0, 1 - ant.steps / 80))'],['const EXPLORATION_PERSISTENCE = 1.3;','const EXPLORATION_PERSISTENCE = 5;']],
};
const boundaryRelease = [
  ['ant.steps = 0;', 'ant.steps = 0; ant.searchOutward = true;'],
  ['const explore = random() < 0.075;', 'if (!hasGoal && currentClearance < EDGE_ESCAPE_BAND && ant.steps > 10) ant.searchOutward = false;\n      const explore = random() < 0.075;'],
  ['radialProgress * EXPLORATION_RADIUS_BIAS', 'radialProgress * EXPLORATION_RADIUS_BIAS * (ant.searchOutward === false ? 0 : 1)']
];
variants.boundaryRelease = boundaryRelease;
variants.boundaryRelease3 = [...boundaryRelease, ['const EXPLORATION_PERSISTENCE = 1.3;', 'const EXPLORATION_PERSISTENCE = 3;']];
variants.boundaryRelease5 = [...boundaryRelease, ['const EXPLORATION_PERSISTENCE = 1.3;', 'const EXPLORATION_PERSISTENCE = 5;']];
variants.boundaryReleaseSoft = [...boundaryRelease, ['const EDGE_ESCAPE_BAND = 30;', 'const EDGE_ESCAPE_BAND = 60;'], ['const EXPLORATION_PERSISTENCE = 1.3;', 'const EXPLORATION_PERSISTENCE = 3;']];
variants.persistent12 = [['const EXPLORATION_RADIUS_BIAS = 0.35;', 'const EXPLORATION_RADIUS_BIAS = 0;'],['const EXPLORATION_PERSISTENCE = 1.3;','const EXPLORATION_PERSISTENCE = 12;']];
function bearingPatches(turn, persistence) {return [
  ['const EXPLORATION_RADIUS_BIAS = 0.35;', 'const EXPLORATION_RADIUS_BIAS = 0;'],
  ['const EXPLORATION_PERSISTENCE = 1.3;', `const EXPLORATION_PERSISTENCE = ${persistence};`],
  ['ant.searchBudget = searchBudget(ant);', 'ant.searchBudget = searchBudget(ant); ant.searchAngle = ant.excursions === 1 ? ant.angle : ant.angle + ant.excursions * 2.399963229728653;'],
  ['const explore = random() < 0.075;', `if (!Number.isFinite(ant.searchAngle)) ant.searchAngle = ant.angle;
      let headingX = Math.cos(ant.searchAngle), headingY = Math.sin(ant.searchAngle);
      if ((current.x < 30 && headingX < 0) || (current.x > width - 30 && headingX > 0)) headingX = -headingX;
      if ((current.y < 30 && headingY < 0) || (current.y > height - 30 && headingY > 0)) headingY = -headingY;
      ant.searchAngle = Math.atan2(headingY, headingX);
      const explore = random() < 0.075;`],
  ['Math.cos(direction - ant.angle)', 'Math.cos(direction - ant.searchAngle)'],
  ['if (pick <= 0) return choice.id;', `if (pick <= 0) {
        if (!hasGoal) {const next = center(choice.id), a = Math.atan2(next.y - ant.y, next.x - ant.x); ant.searchAngle += ${turn} * Math.atan2(Math.sin(a - ant.searchAngle), Math.cos(a - ant.searchAngle));}
        return choice.id;
      }`]
];}
variants.bearing = bearingPatches(.08, 3);
variants.bearing5 = bearingPatches(.08, 5);
variants.bearing15 = bearingPatches(.15, 3);
variants.bearingBase = bearingPatches(.08, 3).map(([a,b]) => [a, b.replace('ant.searchAngle = ant.excursions === 1 ? ant.angle : ant.angle + ant.excursions * 2.399963229728653;', 'ant.departureAngle = (ant.departureAngle ?? ant.angle - 2.399963229728653) + 2.399963229728653; ant.searchAngle = ant.departureAngle;')]);
function rng(seed) {return ()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);}
function factory(patches) {let code=patches === null ? fs.readFileSync(path.join(__dirname,'..','renderer','colony.js'),'utf8') : source;for(const [a,b] of patches||[]){if(!code.includes(a))throw Error(a);code=code.replace(a,b);} const scope={};new Function('window',code)(scope);return scope.createColony;}
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
const median=a=>a.filter(Number.isFinite).sort((a,b)=>a-b)[Math.floor(a.filter(Number.isFinite).length/2)]??null;
const report=[];
for (const [name,patches] of Object.entries(variants)) {
  if (only && !only.includes(name)) continue;
  const make=factory(patches), result={name};
  for (const [label,setup] of Object.entries({empty:{width:1229,height:691,nest:{x:82,y:38}},desktop})) {
    let quadrant=[0,0,0,0], edge=0, n=0, coverage=[];
    for(let seed=1;seed<=seeds;seed++) {
      const colony=make({...setup,gridSize:10,count:36,random:rng(seed)}), seen=new Set();
      for(let t=1;t<=1800;t++) {
        colony.step(.1);
        if(t%10)continue;
        const s=colony.snapshot({includePheromone:false,includeBestPath:false});
        for(const ant of s.ants){seen.add(Math.floor(ant.x/80)+':'+Math.floor(ant.y/80)); if(t<600)continue; quadrant[(ant.x>setup.width/2?1:0)+(ant.y>setup.height/2?2:0)]++;if(Math.min(ant.x,ant.y,setup.width-ant.x,setup.height-ant.y)<30)edge++;n++;}
      }
      coverage.push(seen.size);
    }
    result[label]={quadrants:quadrant.map(x=>+(x/n*36).toFixed(2)),edgeAnts:+(edge/n*36).toFixed(2),sectors:avg(coverage)};
  }
  for (const [label,setup,seconds] of [['far4k',{width:3840,height:2160,nest:{x:45,y:45},food:{x:3450,y:1850}},180],['foodDesktop',{...desktop,food:{x:383.2,y:540.8}},120]]) {
    let times=[],trips=[];
    for(let seed=1;seed<=seeds;seed++) {
      const colony=make({...setup,gridSize:10,count:36,random:rng(seed)});let found=null;
      for(let t=1;t<=seconds*10;t++){colony.step(.1);if(t%10)continue;const s=colony.snapshot({includePheromone:false,includeBestPath:false});if(found===null&&s.discoveries)found=t/10;if(label==='far4k'&&found!==null)break;}
      times.push(found);trips.push(colony.snapshot({includePheromone:false,includeBestPath:false}).completedTrips);
    }
    result[label]={found:times.filter(Number.isFinite).length,median:median(times),times,tripsMedian:median(trips)};
  }
  console.log(JSON.stringify(result));
  report.push(result);
}
fs.writeFileSync(path.join(__dirname, 'exploration-results.json'), JSON.stringify({ seeds, observation:'60-180 simulated seconds', results:report }, null, 2));
