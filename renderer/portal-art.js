const TAU = Math.PI * 2;
const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// Shared by the ant sprite and carried morsel: both cross the same membrane.
export function portalPose(ant, portal) {
  const entering = ant.mode === 'deposit' && Boolean(portal?.mouth);
  const emerging = !entering && portal?.mouth && Number.isFinite(ant.departureProgress) && ant.departureProgress < 1;
  if (!entering && !emerging) return { x:ant.x, y:ant.y, scale:1, alpha:1, active:false };
  const progress = clamp(entering ? ant.entryProgress : ant.departureProgress);
  const eased = progress * progress * (3 - 2 * progress);
  const amount = entering ? eased : 1 - eased;
  const sway = Math.sin(Math.PI * progress) * ((ant.id % 5) - 2) * 0.55;
  return { x:ant.x + (portal.mouth.x - ant.x) * amount + sway,
    y:ant.y + (portal.mouth.y - ant.y) * amount,
    scale:1 - amount * 0.78, alpha:entering ? 1 - Math.pow(progress, 1.6) : Math.sin(progress * Math.PI / 2),
    active:true, entering, progress };
}

export function drawPortalIcon(context, rect, time, backdrop) {
  const { x, y, w, h } = rect;
  context.save();
  // Replace only the image footprint; the native label and drag hit area survive.
  context.beginPath(); context.rect(x, y, w, h); context.clip();
  if (backdrop) context.drawImage(backdrop, x, y, w, h);
  else { context.fillStyle = '#203026'; context.fillRect(x,y,w,h); }
  context.translate(x+w/2,y+h/2);
  const rx=w*0.44, ry=h*0.47, phase=time*0.0014;
  context.lineJoin='round';
  context.beginPath();
  for(let i=0;i<=64;i++) {
    const a=i/64*TAU;
    const r=1+Math.sin(a*7+phase*2)*0.035+Math.sin(a*11-phase)*0.018;
    const px=Math.cos(a)*rx*r, py=Math.sin(a)*ry*r;
    if(i===0)context.moveTo(px,py);else context.lineTo(px,py);
  }
  context.closePath();context.fillStyle='#a7ef26';context.strokeStyle='#172718';context.lineWidth=2.2;
  context.fill();context.stroke();
  context.save();context.clip();
  context.beginPath();context.ellipse(0,0,rx*.84,ry*.88,0,0,TAU);
  context.fillStyle='#3c9b25';context.fill();
  // Uneven animated spiral bands, drawn as flat ink rather than a glowing hole.
  for(let band=0;band<3;band++) {
    context.beginPath();
    for(let i=0;i<=84;i++) {
      const t=i/84, a=phase+band*TAU/3+t*TAU*1.55;
      const r=(.08+t*.85)*(1+Math.sin(a*3-phase)*.06);
      const px=Math.cos(a)*rx*r,py=Math.sin(a)*ry*r;
      if(i===0)context.moveTo(px,py);else context.lineTo(px,py);
    }
    context.strokeStyle=band===0?'#e2ff79':band===1?'#8cda29':'#174d25';
    context.lineWidth=Math.max(1.5,w*.055);context.lineCap='round';context.stroke();
  }
  for(let i=0;i<9;i++) {
    const a=i*2.39996-phase*.45, r=.55+(i%3)*.12;
    context.beginPath();context.ellipse(Math.cos(a)*rx*r,Math.sin(a)*ry*r,
      1+(i%2)*.5, .7+(i%3)*.3,a,0,TAU);
    context.fillStyle=i%2?'#d9ff61':'#266d20';context.fill();
  }
  // Four independent membrane waves continue even when no ant is crossing.
  // Radius expands as opacity fades; no full-screen blur or particle buffer.
  for(let ring=0;ring<4;ring++) {
    const wave=(time*.00032+ring/4)%1;
    const r=.13+.86*wave;
    context.globalAlpha=Math.sin(Math.PI*wave)*.65;
    context.beginPath();
    context.ellipse(Math.sin(phase)*rx*.035,Math.cos(phase*.8)*ry*.025,
      rx*r,ry*r*(.94+Math.sin(phase+ring)*.035),0,0,TAU);
    context.strokeStyle=ring%2?'#edffb4':'#baff38';
    context.lineWidth=(1-wave)*1.6+.45;context.stroke();
  }
  context.restore();context.restore();
}

export function drawPortalContact(context, pose, portal, id) {
  if(!pose.active || !portal?.mouth) return;
  const envelope=Math.sin(pose.progress*Math.PI);
  if(envelope<.03)return;
  const cx=portal.mouth.x,cy=portal.mouth.y;
  const dx=pose.x-cx,dy=pose.y-cy,len=Math.hypot(dx,dy);
  const nx=len>0.1?-dy/len:1, ny=len>0.1?dx/len:0;
  context.save();context.globalAlpha=envelope*.72;
  if(len>3) {
    const base=4.2, tip=Math.max(.5,2.5-len*.035);
    context.beginPath();context.moveTo(cx+nx*base,cy+ny*base);
    context.bezierCurveTo(cx+dx*.55+nx*.7,cy+dy*.55+ny*.7,
      pose.x+nx*tip,pose.y+ny*tip,pose.x,pose.y);
    context.bezierCurveTo(pose.x-nx*tip,pose.y-ny*tip,
      cx+dx*.55-nx*.7,cy+dy*.55-ny*.7,cx-nx*base,cy-ny*base);
    context.closePath();context.fillStyle='#aaff43';context.fill();
    context.strokeStyle='#e5ffa0';context.lineWidth=.6;context.stroke();
  }
  for(let ring=0;ring<2;ring++) {
    const wave=(pose.progress*1.7+ring*.45)%1;
    context.globalAlpha=envelope*(1-wave)*.85;
    context.beginPath();context.ellipse(cx,cy,3+wave*15,2+wave*12,
      (id%3)*.2,0,TAU);
    context.strokeStyle=ring?'#efffa5':'#b8ff42';context.lineWidth=1.2*(1-wave)+.3;context.stroke();
  }
  context.restore();
}
