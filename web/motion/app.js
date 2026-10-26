import * as kit from '/vendor/kit/body.js';

const originalMode=new URLSearchParams(location.search).get('mode')==='original';
const $ = id => document.getElementById(id);
const stage = $('stage'), root = $('root');
let body, manifest, model, baseline, factory, base, packName;
let paused = new URLSearchParams(location.search).has('manual');
let busy = false, current = 'neutral', elapsed = 0, simulationTime = 0, facing = 1, zoom = 1;
let qaImage;
let demo = false, demoIndex = 0, walkOrder = 0, demoAt = 0, talking = false, saved = false, seed = 381729, rejected = '';
const events = [], sounds = [];
const sequence = ['neutral','wave','walk','run','jump','nod','shake','bow','dance','flustered','dizzy','sit','sleep','stand'];
const groupNames = {idle:'待机',walk:'走路',run:'跑步',wave:'挥手',jump:'跳跃',drag:'拖拽',dance:'跳舞',bow:'鞠躬',blink:'眨眼',dizzy:'眩晕',flustered:'慌张'};
const keyNames = {breath:'呼吸',sway:'头摆',head:'头部',arm:'手臂',leg:'腿部',angle:'角度',flail:'扑腾',spin:'转速',jitter:'抖动'};
const name = id => manifest?.vocab?.find(w => w.id === id)?.names?.zh?.[0] || id;
const bounds = () => ({W:stage.clientWidth,H:stage.clientHeight,floorY:stage.clientHeight-14,
  S:zoom * (model?.logo_scale ? stage.clientHeight*.81/(model.canvas[1]*model.logo_scale) : 1.5)});
function random() { seed = (seed*1664525+1013904223)>>>0; return seed/4294967296; }
function seeded(fn) { const original = Math.random; Math.random = random; try{return fn();}finally{Math.random=original;} }
function record(kind, detail) { events.push({time:+simulationTime.toFixed(3),kind,detail}); if(events.length>150)events.shift(); }
function setPaused(value) { paused=!!value; $('pause').textContent=paused?'继续':'暂停'; $('pause').setAttribute('aria-pressed',String(paused)); }
function stopDemo() { demo=false; $('demo').textContent='▶ 连续演示'; }
function fail(error) { $('status').textContent='操作失败：'+error.message; console.error(error); }
async function exclusive(fn) {
  if(busy)return;
  busy=true;
  const controls=[...document.querySelectorAll('button,input,select')];
  controls.forEach(e=>e.disabled=true);
  let failure;
  try{return await fn();}catch(error){failure=error;}finally{busy=false;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);if(!body)document.querySelectorAll('main button,main input,main select').forEach(e=>e.disabled=true);render();if(failure)fail(failure);}
}
async function json(url,options) {
  const response=await fetch(url,options);
  if(!response.ok)throw Error((await response.json().catch(()=>({}))).error || `读取失败 ${response.status}: ${url}`);
  return response.json();
}
const loadImage = url => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('贴图加载失败：'+url));image.src=url;});
async function create() {
  body?.dispose(); body=null; root.replaceChildren(); seed=381729; simulationTime=0; elapsed=0; rejected='';
  const original=Math.random; Math.random=random;
  try {
    body=await factory(base,{kit,model,host:{root,bounds,start:{x:stage.clientWidth/2,facing,enter:'stand'},
      emit:record,sound:(...args)=>{sounds.push(args);if(sounds.length>100)sounds.shift();}},loadImage,asset:p=>new URL(p,base)});
  } finally { Math.random=original; }
  body.set({roam:'off',hold:999,theme:stage.classList.contains('dark')?'dark':'light'});
  seeded(()=>body.step(1/60));
  window.pet=body;
}
function advance(seconds) {
  if(!body || seconds<=0)return;
  seeded(()=>{for(let t=0;t<seconds-1e-9;t+=1/60){const dt=Math.min(1/60,seconds-t);if(talking)body.talk();body.step(dt);simulationTime+=dt;elapsed+=dt;}});
}
function act(id) {
  const accepted=seeded(()=>body.do(id));
  if(accepted && (id==='walk'||id==='run')) {
    const direction=body.layout().facing || facing;
    body.place(stage.clientWidth*(direction===1?.25:.75),direction);
    seeded(()=>body.walk(stage.clientWidth*(direction===1?.75:.25),id==='run',++walkOrder));
  }
  current=id; elapsed=0;
  record('command',{word:id,accepted});
  rejected=accepted?'':id;
  if(model.tune && Object.hasOwn(model.tune,id))$('tuneGroup').value=id;
  renderSliders();render();
  if(!accepted)$('status').textContent=`动作未被当前驱动接受：${id}`;
  return accepted;
}
async function replay(seconds=0) {const word=current;await create();act(word);advance(seconds);render();}
function render() {
  if(!body)return;
  const layout=body.layout();
  $('modeBadge').textContent=(paused?'已暂停 · ':'')+layout.mode;
  $('currentWord').textContent=name(current);
  if(document.activeElement!==$('timeline'))$('timeline').value=Math.min(elapsed,10);
  $('time').textContent=elapsed.toFixed(2)+'s';
  $('status').textContent=`当前：${name(current)} · 状态：${layout.mode} · ${layout.facing===-1?'朝左':'朝右'}${saved?' · 已载入保存参数':''}${rejected?' · 当前状态未接受该动作；点击“重播当前”可独立预览':''}`;
  $('eventCount').textContent=events.length;
  if(document.querySelector('.diagnostics').open)$('diagnostic').textContent=JSON.stringify({pack:packName,layout,visual:body.visualState?.(),events:events.slice(-8)},null,2);
  document.querySelectorAll('[data-word]').forEach(b=>{b.classList.toggle('on',b.dataset.word===current);b.setAttribute('aria-pressed',String(b.dataset.word===current));});
}
function renderSliders() {
  const group=$('tuneGroup').value;
  const ref=model.tune?.[group];
  $('sliders').replaceChildren();
  if(ref===undefined){$('sliders').textContent='此动作包未提供可调参数。';return;}
  const entries=typeof ref==='number'?[['value',ref]]:Object.entries(ref);
  for(const [key,value] of entries) {
    if(typeof value!=='number')continue;
    const row=document.createElement('label'),label=document.createElement('span'),input=document.createElement('input'),output=document.createElement('output');
    label.textContent=key==='value'?groupNames[group]||group:keyNames[key]||key;
    Object.assign(input,{type:'range',min:0,max:4,step:.05,value});output.textContent=value.toFixed(2);input.setAttribute('aria-label',group==='wave'&&key==='angle'?'挥手':label.textContent);
    input.disabled=busy;
    input.oninput=()=>{const value=Number(input.value);if(typeof model.tune[group]==='number')model.tune[group]=value;else model.tune[group][key]=value;output.textContent=value.toFixed(2);$('saveStatus').textContent='参数已修改，尚未保存。';};
    row.append(label,input,output);$('sliders').append(row);
  }
}
function filterWords() {
  const search=$('search').value.trim().toLowerCase();let count=0;
  document.querySelectorAll('[data-word]').forEach(b=>{b.hidden=!`${b.textContent} ${b.dataset.word}`.toLowerCase().includes(search);if(!b.hidden)count++;});
  $('noResults').hidden=count>0;
}
function buildWords() {
  $('motions').replaceChildren();$('expressions').replaceChildren();
  for(const word of manifest.vocab||[]) {
    const b=document.createElement('button');b.textContent=name(word.id);b.dataset.word=word.id;b.title=`${word.id} · ${word.seconds||'?'} 秒（清单声明）`;
    b.onclick=()=>{stopDemo();act(word.id);};$(word.kind==='motion'?'motions':'expressions').append(b);
  }
  $('wordCount').textContent=`${manifest.vocab.filter(w=>w.kind==='motion').length} 动作 / ${manifest.vocab.filter(w=>w.kind!=='motion').length} 表情`;
  $('tuneGroup').replaceChildren(...Object.keys(model.tune||{}).map(group=>{const option=document.createElement('option');option.value=group;option.textContent=groupNames[group]||group;return option;}));
  $('tuneGroup').value='idle';filterWords();renderSliders();
}
async function loadPack(folder) {
  body?.dispose();body=null;root.replaceChildren();
  window.ready=false;stopDemo();talking=false;$('talk').classList.remove('on');events.length=0;facing=1;current='neutral';
  window.lastQA=null;qaImage=null;$('qaReport').hidden=true;$('qaImage').hidden=true;
  packName=folder;const built=await json(originalMode?'/api/native-preview':'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});base=new URL(built.base,location.origin);
  $('importNotice').textContent=built.report.import_notice||'';$('importNotice').hidden=!built.report.import_notice;
  manifest=await json(new URL('figure.json',base));
  const modelURL=new URL(manifest.model,base),entryURL=new URL(manifest.entry,base);
  if(!modelURL.href.startsWith(base.href)||!entryURL.href.startsWith(base.href))throw Error('动作包入口必须位于自身文件夹内');
  model=await json(modelURL);baseline=structuredClone(model.tune||{});saved=false;
  const data=originalMode?{}:await json('/api/tune?pack='+encodeURIComponent(folder));
  if(data.tune){model.tune=data.tune;saved=true;}if(data.defaults)baseline=structuredClone(data.defaults);
  const module=await import(entryURL);factory=module[manifest.export];if(typeof factory!=='function')throw Error('找不到动作包导出函数');
  const displayName=(await json('/api/project')).name||manifest.name?.zh||manifest.id;$('identity').textContent=displayName+(originalMode?' · 原包模式':' · 编辑副本');if(originalMode)$('save').closest('section').hidden=true;$('version').textContent=`${manifest.version} · 官方 kit 驱动`;
  document.title=`${displayName} · 角色工程台动作预览`;
  $('saveStatus').textContent=saved?'已载入独立保存的参数。':'参数单独保存，刷新后自动载入。';
  await create();buildWords();setPaused(paused);render();
  window.model=model;window.ready=true;const requested=new URLSearchParams(location.search).get('pose');if(requested&&manifest.vocab.some(w=>w.id===requested)){act(requested);advance(1.4);if(paused)body.step(0);}
}
function download(data,filename,type) {
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function captureCanvas(background=false) {
  const source=root.querySelector('svg');if(!source)throw Error('角色尚未加载');
  const NS='http://www.w3.org/2000/svg',clone=source.cloneNode(true);
  // SVG image decoding cannot render foreignObject/WebGL. Replace it with a raster of the actual rig.
  const originals=[...source.querySelectorAll('foreignObject')];
  [...clone.querySelectorAll('foreignObject')].forEach((foreign,index)=>{
    const canvas=originals[index].querySelector('canvas');if(!canvas)return;
    const image=document.createElementNS(NS,'image');
    for(const key of ['x','y','width','height','transform'])if(foreign.hasAttribute(key))image.setAttribute(key,foreign.getAttribute(key));
    image.setAttribute('href',canvas.toDataURL('image/png'));foreign.replaceWith(image);
  });
  for(const hidden of clone.querySelectorAll('[visibility="hidden"]'))hidden.remove();
  const style=document.createElementNS(NS,'style');
  style.textContent=[...document.querySelectorAll('style')].map(s=>s.textContent).join('\n');clone.prepend(style);
  clone.setAttribute('xmlns',NS);clone.setAttribute('width',stage.clientWidth);clone.setAttribute('height',stage.clientHeight);clone.setAttribute('viewBox',`0 0 ${stage.clientWidth} ${stage.clientHeight}`);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
  try {
    const image=await loadImage(url),canvas=document.createElement('canvas');canvas.width=stage.clientWidth;canvas.height=stage.clientHeight;
    const ctx=canvas.getContext('2d');if(background){ctx.fillStyle=stage.classList.contains('dark')?'#252331':'#f4f0f8';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(image,0,0);return canvas;
  } finally { URL.revokeObjectURL(url); }
}
async function runQA() {
  const restore={word:current,facing,paused,elapsed:Math.min(elapsed,10),talking,group:$('tuneGroup').value};
  stopDemo();setPaused(true);talking=false;
  const words=[...new Set([current,'wave','jump','sit','dizzy','stand'])].filter(id=>manifest.vocab.some(w=>w.id===id));
  const sheet=document.createElement('canvas');sheet.width=960;sheet.height=words.length*2*310;
  const ctx=sheet.getContext('2d');ctx.fillStyle='#f4f0f8';ctx.fillRect(0,0,sheet.width,sheet.height);
  const samples=[];let row=0;
  try {
    for(const direction of [1,-1])for(const word of words) {
      facing=direction;await create();const accepted=act(word);let previous=0;
      for(const [column,time] of [0.3,1.2,3.2].entries()) {
        advance(time-previous);previous=time;
        const image=await captureCanvas(true),scale=Math.min(320/image.width,275/image.height);
        const x=column*320,y=row*310;
        ctx.fillStyle='#766082';ctx.font='13px "Microsoft YaHei",sans-serif';ctx.fillText(`${name(word)} · ${direction===1?'朝右':'朝左'} · ${time}s`,x+12,y+22);
        ctx.drawImage(image,x+(320-image.width*scale)/2,y+30,image.width*scale,image.height*scale);
        samples.push({word,facing:direction,time,accepted,layout:body.layout(),visual:body.visualState?.()});
        $('status').textContent=`双向采样 ${samples.length}/${words.length*6}`;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      row++;
    }
    const report={pack:packName,version:manifest.version,created:new Date().toISOString(),tune:structuredClone(model.tune),
      note:'有限时间点的浏览器采样；请结合联系表人工检查接缝、遮挡和恢复。未验证原生桌面宿主。',samples};
    qaImage=await new Promise(resolve=>sheet.toBlob(resolve));
    window.lastQA=report;
    $('qaReport').hidden=false;$('qaImage').hidden=false;
  } finally {
    facing=restore.facing;current=restore.word;talking=restore.talking;await replay(restore.elapsed);$('tuneGroup').value=restore.group;renderSliders();setPaused(restore.paused);
  }
}

$('refreshProject').onclick=()=>exclusive(()=>loadPack(packName));
$('pause').onclick=()=>setPaused(!paused);
$('step').onclick=()=>{stopDemo();setPaused(true);advance(1/60);render();};
$('replay').onclick=()=>exclusive(async()=>{stopDemo();await replay();});
$('restart').onclick=()=>exclusive(async()=>{stopDemo();current='neutral';await create();act('neutral');});
$('left').onclick=()=>{facing=-1;body.place(stage.clientWidth/2,facing);render();};
$('right').onclick=()=>{facing=1;body.place(stage.clientWidth/2,facing);render();};
$('demo').onclick=()=>{if(demo){stopDemo();return;}demo=true;demoIndex=0;demoAt=simulationTime;setPaused(false);};
$('bg').onclick=()=>{const dark=stage.classList.toggle('dark');body.set({theme:dark?'dark':'light'});};
$('checker').onclick=()=>{$('checker').classList.toggle('on',stage.classList.toggle('checker'));};
$('guide').onclick=()=>{$('guides').hidden=!$('guides').hidden;$('guide').classList.toggle('on',!$('guides').hidden);};
$('talk').onclick=()=>{talking=!talking;$('talk').classList.toggle('on',talking);};
$('zoom').oninput=()=>{zoom=Number($('zoom').value);$('zoomValue').textContent=Math.round(zoom*100)+'%';body.resize();advance(1/60);};
$('tuneGroup').onchange=renderSliders;$('search').oninput=filterWords;
$('pack').onchange=()=>exclusive(()=>loadPack($('pack').value));
$('defaults').onclick=()=>{model.tune=structuredClone(baseline);renderSliders();$('saveStatus').textContent='已恢复动作包推荐值，尚未保存。';};
$('save').onclick=()=>exclusive(async()=>{
  await json('/api/save-tune',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pack:packName,tune:model.tune})});
  saved=true;$('saveStatus').textContent='参数已保存，下次自动载入。';
});
$('exportTune').onclick=()=>download(JSON.stringify({pack:packName,version:manifest.version,tune:model.tune},null,2),`${manifest.id}-${manifest.version}-tune.json`,'application/json');
$('capture').onclick=()=>exclusive(async()=>{const image=await captureCanvas();download(await new Promise(resolve=>image.toBlob(resolve)),`${manifest.id}-${current}-${elapsed.toFixed(2)}s.png`,'image/png');});
$('qa').onclick=()=>exclusive(runQA);
$('qaImage').onclick=()=>{if(qaImage)download(qaImage,`${manifest.id}-双向动作检查.png`,'image/png');};
$('qaReport').onclick=()=>{if(window.lastQA)download(JSON.stringify(window.lastQA,null,2),`${manifest.id}-动作检查.json`,'application/json');};
$('timeline').oninput=()=>{
  setPaused(true);stopDemo();const target=Number($('timeline').value);$('time').textContent=target.toFixed(2)+'s';
};
$('timeline').onchange=()=>exclusive(()=>replay(Number($('timeline').value)));
function point(event) {const rect=stage.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top,t:performance.now(),button:event.button,pointerType:event.pointerType};}
stage.addEventListener('pointerdown',event=>{if(!body||busy)return;stopDemo();stage.setPointerCapture(event.pointerId);seeded(()=>body.pointer('down',point(event)));});
stage.addEventListener('pointermove',event=>{if(body&&!busy)seeded(()=>body.pointer('move',point(event)));});
for(const type of ['pointerup','pointercancel','pointerleave'])stage.addEventListener(type,event=>{if(body&&!busy)seeded(()=>body.pointer(type==='pointerup'?'up':type==='pointercancel'?'cancel':'leave',point(event)));});
new ResizeObserver(()=>{if(body&&!busy){body.resize();body.step(0);}}).observe(stage);
document.addEventListener('keydown',event=>{
  if(!body||busy||event.ctrlKey||event.altKey||event.metaKey||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName))return;
  if(event.code==='Space'){event.preventDefault();$('pause').click();}
  if(event.code==='ArrowRight'){event.preventDefault();$('step').click();}
  if(event.code==='KeyR')$('replay').click();
});
window.act=act;window.setPaused=setPaused;window.resetPet=create;window.events=events;window.sounds=sounds;
window.preview={advance,seek:async seconds=>{setPaused(true);await replay(seconds);},captureCanvas,runQA,state:()=>({current,elapsed,paused,busy,pack:packName})};
try {
  const data=await json('/api/packs');
  $('pack').replaceChildren(...data.packs.map(pack=>{const option=document.createElement('option');option.value=pack.folder;option.textContent=`${pack.name} · ${pack.version}`;return option;}));
  $('pack').value=data.default;
  await exclusive(()=>loadPack(data.default));
} catch(error) {fail(error);}
let previous=performance.now(),lastRender=0;
function tick(now) {
  const dt=Math.min((now-previous)/1000,.05);previous=now;
  if(body&&!busy&&!paused) {
    if(demo&&simulationTime>=demoAt) {
      const available=sequence.filter(id=>manifest.vocab.some(word=>word.id===id)),id=available[demoIndex++%available.length];
      seeded(()=>body.do('stand'));act(id);demoAt=simulationTime+(id==='sleep'?4.5:3.8);$('demo').textContent='■ 停止演示 · '+name(id);
    }
    advance(dt*Number($('speed').value));
  }
  if(now-lastRender>100&&!busy){render();lastRender=now;}
  requestAnimationFrame(tick);
}
setPaused(paused);requestAnimationFrame(tick);
