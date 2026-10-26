import * as kit from '/vendor/kit/body.js';
import {createExpressionFace} from '/runtime/face.js';
const $=id=>document.getElementById(id),api=studio.api,canvas=$('canvas'),g=canvas.getContext('2d');
const faces={neutral:'平静',happy:'开心',wink:'单眼眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'犯困',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'认真',flustered:'慌张',scared:'害怕',excited:'期待',cry:'大哭',confused:'疑惑'};
let config,assembly,model,rows=[],selected='',images=new Map(),history=[],dirty=false,drag,playing=false,playTime=0,lastFrame=0,renderGeneration=0,engineCache;
const controls={};for(const [key,label]of Object.entries({x:'X',y:'Y',w:'宽',h:'高',rot:'旋转°',z:'图层'})){const l=document.createElement('label');l.textContent=label;const e=document.createElement('input');e.type='number';e.step='any';e.setAttribute('aria-label',label);l.append(e);$('fields').append(l);controls[key]=e;e.oninput=()=>{if(e.value==='')return;edit(p=>{const v=Number(e.value);if(!Number.isFinite(v)||(key==='w'||key==='h')&&v<=0)throw Error('尺寸须大于零');if($('aspect').checked&&key==='w')p.h*=v/p.w;if($('aspect').checked&&key==='h')p.w*=v/p.h;p[key]=v;});};}
for(const [key,label]of Object.entries(faces)){const o=document.createElement('option');o.value=key;o.textContent=label;$('state').append(o);}
const clone=v=>structuredClone(v),rowOf=(id,source=assembly.parts)=>source.find(p=>p.id===id),pose=p=>({box:[p.x,p.y,p.w,p.h],rotation:p.rot||0,z:p.z||0});
function partFromPose(id,p){return{id,...Object.fromEntries(['x','y','w','h'].map((k,i)=>[k,p.box[i]])),rot:p.rotation||0,z:p.z||0,hidden:false,pinned:false};}
function stateKey(){return $('state').value;}function scope(){return $('scope').value;}function current(){return rows.find(p=>p.id===selected);}
function editable(){if(config.engine!=='layered')return [];const f=model.expressionFace||{};return scope()==='blink'?Object.values(f.normalEyes||{}).map(e=>e.lid):scope()==='seated'?(model.seatedLegs?.parts||[]).map(p=>p.id):f.calibrationFacialIds||[];}
function remember(){if(scope()==='expression')assembly.expressionLayouts[stateKey()]={parts:clone(rows)};else if(scope()==='blink'){for(const p of rows){const side=Object.keys(model.expressionFace.normalEyes).find(k=>model.expressionFace.normalEyes[k].lid===p.id);(assembly.blinkCalibration[side]??={})[$('phase').value]=pose(p);}}else{for(const p of rows){const i=assembly.parts.findIndex(q=>q.id===p.id);assembly.parts[i]=clone(p);}}}
function choose(){
 playing=false;$('play').textContent='播放过渡';history=[];const ids=editable();
 if(scope()==='expression')rows=clone(assembly.expressionLayouts[stateKey()]?.parts||ids.map(id=>({...rowOf(id),hidden:false}))).filter(p=>p&&ids.includes(p.id));
 else if(scope()==='blink')rows=ids.map(id=>{const side=Object.keys(model.expressionFace.normalEyes).find(k=>model.expressionFace.normalEyes[k].lid===id);const p=assembly.blinkCalibration[side]?.[$('phase').value];return p?partFromPose(id,p):clone(rowOf(id));});
 else rows=ids.map(id=>clone(rowOf(id))).filter(Boolean);
 if(!rows.some(p=>p.id===selected))selected=rows[0]?.id||'';
 $('stateLabel').hidden=scope()!=='expression';$('phaseLabel').hidden=scope()!=='blink';$('authored').disabled=scope()!=='expression';$('setNeutralStart').disabled=scope()!=='expression';$('authored').checked=!!assembly.authoredLashTransitions[stateKey()];
 $('hidden').disabled=scope()==='blink';$('progress').value=scope()==='blink'&&$('phase').value==='start'?0:1;
 $('error').textContent=config.engine!=='layered'?'请先在功能配置中选择高级部件动作，再指定眼睛或坐姿部件。':rows.length?'':scope()==='seated'?'请先在功能配置中启用坐姿替换图。':'请先在功能配置中指定左右眼、嘴型或眉毛。';list();inspect();render();
}
function list(){const list=$('parts');list.replaceChildren();for(const p of rows){const o=document.createElement('option');o.value=p.id;o.textContent=(p.hidden?'○ ':'● ')+p.id+(p.pinned?' 🔒':'');list.append(o);}list.value=selected;}
function inspect(){const p=current();$('selection').textContent=p?.id||'未选择';for(const [k,e]of Object.entries(controls)){e.value=p?.[k]??'';e.disabled=!p;}if(p){$('hidden').checked=!!p.hidden;$('pinned').checked=!!p.pinned;}}
function endpoint(){return scope()!=='blink'?Number($('progress').value)===1:Number($('progress').value)===($('phase').value==='start'?0:1);}
function snapshot(){history.push({rows:clone(rows),transitions:clone(assembly.authoredLashTransitions)});if(history.length>80)history.shift();}
function edit(fn){try{const p=current();if(!p)return;if(p.pinned)throw Error('请先解除固定');if(!endpoint())throw Error('请先将进度移到正在编辑的端点');snapshot();fn(p);dirty=true;remember();list();inspect();render();$('status').textContent='当前组已修改，尚未保存。';}catch(e){$('status').textContent=e.message;inspect();}}
function rawScene(){const ids=new Map(rows.map(p=>[p.id,p]));let scene=assembly.parts.map(p=>clone(ids.get(p.id)||p));if(scope()==='expression')scene=scene.map(p=>ids.has(p.id)?clone(ids.get(p.id)):p);return scene;}
function drawImage(p,image,st={},special=false){
 if(!image||p.hidden)return;const a=(special?0:(p.rot||0))*Math.PI/180,cx=p.x+p.w/2,cy=p.y+p.h/2,c=Math.cos(a),s=Math.sin(a),node=st[(special?'expression:':'eye:')+p.id]||{};
 const point=(x,y)=>{if(node.fn){const d=node.fn(0,0,x,y);return[x+d[0],y+d[1]];}const angle=(node.a||0)*Math.PI/180,dx=(x-cx)*(node.sx??node.s??1),dy=(y-cy)*(node.sy??node.s??1);return[cx+(node.tx||0)+Math.cos(angle)*dx-Math.sin(angle)*dy,cy+(node.ty||0)+Math.sin(angle)*dx+Math.cos(angle)*dy];};
 const q=point(cx,cy),x=point(cx+c,cy+s),y=point(cx-s,cy+c);g.save();g.globalAlpha=st.alpha?.[(special?'expression:':'')+p.id]??(special?0:1);g.transform(x[0]-q[0],x[1]-q[1],y[0]-q[0],y[1]-q[1],q[0],q[1]);g.drawImage(image,-p.w/2,-p.h/2,p.w,p.h);g.restore();
}
async function render(){
 const generation=++renderGeneration,zoom=Number($('zoom').value)/100,[W,H]=model.canvas;canvas.width=Math.ceil(W*zoom);canvas.height=Math.ceil(H*zoom);g.setTransform(zoom,0,0,zoom,0,0);g.clearRect(0,0,W,H);$('progressText').textContent=Math.round(Number($('progress').value)*100)+'%';
 let scene=rawScene(),st={alpha:{}},uploads=new Map(),result={};const f=model.expressionFace||{},assets=f.assets||{},assetIds=new Set(Object.keys(assets)),seatIds=new Set((model.seatedLegs?.parts||[]).map(p=>p.id));
 if(scope()==='blink'){const layout=assembly.expressionLayouts.neutral?.parts||[];const byId=new Map(layout.map(p=>[p.id,p]));scene=assembly.parts.map(p=>clone(byId.get(p.id)||p));}
 if(scope()==='seated'){
  const seat=model.seatedLegs||{},hide=new Set(seat.replaceIds||model.parts.filter(p=>['legNear','legFar'].includes(p.node)).map(p=>p.id));
  scene=scene.map(p=>{if(hide.has(p.id))p.hidden=true;if(seatIds.has(p.id)){p.hidden=false;const spec=seat.parts.find(q=>q.id===p.id);p.y+=(spec.groundOffset||0)/model.logo_scale;}else if(!assetIds.has(p.id))p.y+=(seat.bodyDrop||0)/model.logo_scale;p.z=seat.calibratedLayers?.[p.id]??p.z;return p;});
 }
 if(config.engine==='layered'&&!$('raw').checked&&scope()!=='seated'){
  try{
   const byId=new Map(scene.map(p=>[p.id,p])),parts=model.parts.map(p=>{const row=byId.get(p.id);return row?{...p,box:[row.x,row.y,row.w,row.h],rot:row.rot||0}:p;}),faceConfig={...f,assets:Object.fromEntries(Object.entries(assets).map(([id,p])=>{const row=byId.get(id);return[id,row?{...p,box:[row.x,row.y,row.w,row.h],rotation:row.rot||0,z:row.z,hidden:scope()==='blink'?p.hidden:row.hidden}:p];})),authoredLashTransitions:assembly.authoredLashTransitions,blinkCalibration:assembly.blinkCalibration};
   const local={...model,parts,expressionFace:faceConfig,logo_scale:1,center_x:128,feet_y:256},key=JSON.stringify(local);
   if(engineCache?.key!==key){const engine=await createExpressionFace({doc:document,model:local,load:async file=>{const spec=Object.entries(assets).find(([,p])=>p.file===file);return images.get(spec?.[0])||images.get(parts.find(p=>p.file===file)?.id);},parts:[],defs:{},textures:new Map(model.parts.map(p=>[p.id,images.get(p.id)])),X:x=>x,Y:y=>y});if(generation!==renderGeneration)return;engineCache={key,engine};}
   engineCache.engine.reset();const state=scope()==='blink'?'neutral':stateKey(),blink=scope()==='blink'?Number($('progress').value):0;
   result=engineCache.engine.update({f:{face:state,mode:'idle',t:0,eyeClose:0,expressionProgress:Number($('progress').value)},face:kit.FACES[state].f(0),blink,look:[0,0],talk:0,dt:10},st,{upload:(id,im)=>uploads.set(id,im)});
  }catch(e){$('error').textContent='效果预览：'+e.message;}
 }
 if(generation!==renderGeneration)return;
 for(const p of scene.sort((a,b)=>a.z-b.z)){
  if(seatIds.has(p.id)&&scope()!=='seated')continue;
  if(assetIds.has(p.id)){if($('raw').checked){if(rows.some(r=>r.id===p.id)&&!p.hidden)drawImage(p,images.get(p.id));}else drawImage(p,images.get(p.id),st,true);}
  else{if(result.mouth&&model.parts.find(q=>q.id===p.id)?.node==='mouth')continue;drawImage(p,uploads.get(p.id)||images.get(p.id),st);}
 }
 const p=current();if(p&&endpoint()){
  g.save();g.translate(p.x+p.w/2,p.y+p.h/2);g.rotate((p.rot||0)*Math.PI/180);g.strokeStyle='#8eb2ff';g.lineWidth=1.5/zoom;g.strokeRect(-p.w/2,-p.h/2,p.w,p.h);g.fillStyle='#fff';for(const [x,y]of [[-p.w/2,-p.h/2],[p.w/2,-p.h/2],[p.w/2,p.h/2],[-p.w/2,p.h/2]])g.fillRect(x-4/zoom,y-4/zoom,8/zoom,8/zoom);g.beginPath();g.arc(0,-p.h/2-24/zoom,6/zoom,0,Math.PI*2);g.fill();g.restore();
 }
 document.body.dataset.ready='true';
}
function point(e){const r=canvas.getBoundingClientRect(),z=Number($('zoom').value)/100;return[(e.clientX-r.left)/z,(e.clientY-r.top)/z];}
function local(p,x,y){const a=-(p.rot||0)*Math.PI/180,dx=x-p.x-p.w/2,dy=y-p.y-p.h/2;return[Math.cos(a)*dx-Math.sin(a)*dy,Math.sin(a)*dx+Math.cos(a)*dy];}
canvas.onpointerdown=e=>{
 if(!endpoint())return;$('error').textContent='';const [x,y]=point(e),z=Number($('zoom').value)/100;let p=current(),mode='move',corner;
 if(p){const [lx,ly]=local(p,x,y);if(Math.hypot(lx,ly+p.h/2+24/z)<12/z)mode='rotate';else{corner=[[-1,-1],[1,-1],[1,1],[-1,1]].find(([sx,sy])=>Math.hypot(lx-sx*p.w/2,ly-sy*p.h/2)<12/z);if(corner)mode='resize';else p=null;}}
 if(!p){p=[...rows].sort((a,b)=>b.z-a.z).find(p=>{const [lx,ly]=local(p,x,y);return !p.hidden&&Math.abs(lx)<=p.w/2&&Math.abs(ly)<=p.h/2;});if(!p)return;selected=p.id;list();inspect();render();}
 if(p.pinned)return;snapshot();drag={mode,corner,start:[x,y],pose:clone(p),startAngle:Math.atan2(y-p.y-p.h/2,x-p.x-p.w/2)};canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove=e=>{if(!drag)return;const [x,y]=point(e),p=current(),o=drag.pose;if(drag.mode==='move'){p.x=o.x+x-drag.start[0];p.y=o.y+y-drag.start[1];}else if(drag.mode==='rotate'){p.rot=o.rot+(Math.atan2(y-o.y-o.h/2,x-o.x-o.w/2)-drag.startAngle)*180/Math.PI;}else{const [dx,dy]=local(o,x,y),[sx,sy]=drag.corner;let w=Math.max(1,sx*dx*2),h=Math.max(1,sy*dy*2);if($('aspect').checked)h=w*o.h/o.w;p.w=w;p.h=h;p.x=o.x+o.w/2-w/2;p.y=o.y+o.h/2-h/2;}dirty=true;remember();inspect();render();};
canvas.onpointerup=()=>{drag=null;};canvas.onpointercancel=()=>{drag=null;};
async function save(){
 remember();if(scope()==='expression')await api('calibration',{scope:'expression',state:stateKey(),layout:{parts:rows},transition:assembly.authoredLashTransitions[stateKey()]||null});
 else if(scope()==='blink'){for(const side of Object.keys(model.expressionFace.normalEyes||{})){await api('calibration',{scope:'blink',side,phase:$('phase').value,pose:assembly.blinkCalibration[side][$('phase').value]});}}
 else await api('save',assembly);dirty=false;$('status').textContent='已保存当前组的精确位置、大小、旋转和层级。';
}
$('save').onclick=()=>save().catch(e=>$('status').textContent=e.message);window.studioSave=async()=>{try{if(dirty)await save();return true;}catch(e){$('status').textContent=e.message;return false;}};
for(const id of ['scope','state','phase'])$(id).onchange=async()=>{try{if(dirty){/* The old selection has already changed; restore it while persisting. */const next={scope:$('scope').value,state:$('state').value,phase:$('phase').value};$('scope').value=previous.scope;$('state').value=previous.state;$('phase').value=previous.phase;await save();for(const [k,v]of Object.entries(next))$(k).value=v;}previous={scope:scope(),state:stateKey(),phase:$('phase').value};choose();}catch(e){$('status').textContent=e.message;}};
let previous={scope:'expression',state:'neutral',phase:'start'};
$('parts').onchange=()=>{selected=$('parts').value;inspect();render();};$('progress').oninput=()=>{playing=false;render();};$('zoom').onchange=render;$('raw').onchange=render;
$('hidden').onchange=()=>edit(p=>p.hidden=$('hidden').checked);$('pinned').onchange=()=>{const p=current();if(!p)return;snapshot();p.pinned=$('pinned').checked;dirty=true;remember();list();render();};
$('up').onclick=()=>edit(p=>p.z+=1);$('down').onclick=()=>edit(p=>p.z-=1);
$('undo').onclick=()=>{const last=history.pop();if(!last)return;rows=last.rows;assembly.authoredLashTransitions=last.transitions;dirty=true;remember();list();inspect();render();};
$('setNeutralStart').onclick=()=>{
 snapshot();const near={};for(const [side,ids]of Object.entries(model.expressionFace?.normalEyes||{})){const p=rowOf(ids.lid,assembly.expressionLayouts.neutral?.parts||[])||rowOf(ids.lid);near[side]=pose(p);}assembly.authoredLashTransitions[stateKey()]={start:near,endpoint:'authored-layout'};$('authored').checked=true;dirty=true;remember();render();
};$('authored').onchange=()=>{if($('authored').checked)$('setNeutralStart').click();else{snapshot();delete assembly.authoredLashTransitions[stateKey()];dirty=true;render();}};
$('frame').onclick=()=>{$('progress').value=Math.min(1,Number($('progress').value)+1/60);render();};
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'暂停过渡':'播放过渡';playTime=Number($('progress').value)>=1?0:Number($('progress').value);};
function tick(t){if(playing&&model){playTime+=(t-lastFrame)/1000;if(playTime>=1){playTime=1;playing=false;$('play').textContent='播放过渡';}$('progress').value=playTime;render();}lastFrame=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);
$('motion').onclick=async()=>{if(await window.studioSave())location.href=`/p/${studio.project}/motion/?manual&pose=${scope()==='seated'?'sit':scope()==='expression'?stateKey():'neutral'}`;};
async function load(){
 [config,assembly,model]=await Promise.all([api('project'),fetch('assembly-v4.json').then(r=>r.json()),api('effective-model')]);assembly.expressionLayouts??=clone(model.expressionFace?.expressionLayouts||{});assembly.authoredLashTransitions??=clone(model.expressionFace?.authoredLashTransitions||{});const savedBlink=assembly.blinkCalibration||{};assembly.blinkCalibration=clone(model.expressionFace?.blinkCalibration||{schema:1,interpolation:'smoothstep'});for(const side of ['near','far'])if(savedBlink[side])assembly.blinkCalibration[side]={...assembly.blinkCalibration[side],...savedBlink[side]};
 await Promise.all(assembly.parts.map(p=>new Promise(resolve=>{const im=new Image();im.onload=()=>{images.set(p.id,im);resolve();};im.onerror=resolve;im.src=`parts/${encodeURIComponent(p.id)}.png`;})));
 const q=new URLSearchParams(location.search);$('state').value=faces[q.get('state')]?q.get('state'):'neutral';$('scope').value=['blink','seated'].includes(q.get('scope'))?q.get('scope'):'expression';if(q.get('phase')==='end')$('phase').value='end';previous={scope:scope(),state:stateKey(),phase:$('phase').value};
 $('zoom').value=Math.round(Math.min(1,($('viewport').clientHeight-50)/model.canvas[1],($('viewport').clientWidth-50)/model.canvas[0])*100);choose();$('status').textContent='已读取保存结果；只修改当前组，不自动调整其他表情。';
}
load().catch(e=>$('status').textContent='读取失败：'+e.message);
