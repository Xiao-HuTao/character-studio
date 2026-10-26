const $=id=>document.getElementById(id),api=studio.api;
const faces={neutral:'平静',happy:'开心',wink:'单眼眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'犯困',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'认真',flustered:'慌张',scared:'害怕',excited:'期待',cry:'大哭',confused:'疑惑'};
const groups={hair:'后发',bangs:'刘海',ribbon:'缎带',skirt:'裙摆'},defaults={hair:[8,.62,4,3.2],bangs:[13,.82,1.1,.9],ribbon:[10,.55,3.2,2.4],skirt:[12,.8,1.2,1.1]};
let config,assembly,model,feature,all=[],sprites=[],seat=[],physics=[];const roleControls={},browControls={},geometryControls={};
const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;};
function select(items,value=''){const s=document.createElement('select');for(const [k,v]of items)s.append(option(k,v));s.value=value;return s;}
function partSelect(value=''){return select([['','未指定'],...all.map(p=>[p.id,p.id])],value);}
function input(value,type='number'){const e=document.createElement('input');e.type=type;e.value=value??'';if(type==='number')e.step='any';return e;}
function field(parent,label,e){const l=document.createElement('label');l.textContent=label;l.append(e);parent.append(l);return e;}
function row(parent,controls,remove){const tr=document.createElement('tr');for(const e of controls){const td=document.createElement('td');td.append(e);tr.append(td);}if(remove){const b=document.createElement('button');b.textContent='移除';b.onclick=remove;const td=document.createElement('td');td.append(b);tr.append(td);}parent.append(tr);}
function spriteRows(){
 $('sprites').replaceChildren();for(const s of sprites){s.part=partSelect(s.id);s.kindControl=select([['eye','替换眼'],['mouth','替换嘴']],s.kind);s.stateControl=input(s.state,'text');s.sideControl=select([['near','近侧'],['far','远侧']],s.side||'near');row($('sprites'),[s.part,s.kindControl,s.stateControl,s.sideControl],()=>{sprites.splice(sprites.indexOf(s),1);spriteRows();});}
}
function seatRows(){
 $('seated').replaceChildren();for(const s of seat){s.part=partSelect(s.id);s.sideControl=select([['Near','近侧'],['Far','远侧']],s.side);s.offsetControl=input(s.groundOffset||0);row($('seated'),[s.part,s.sideControl,s.offsetControl],()=>{seat.splice(seat.indexOf(s),1);seatRows();});}
}
function physicsRows(){
 $('physics').replaceChildren();for(const s of physics){s.part=partSelect(s.id);s.groupControl=select(Object.entries(groups),s.group);s.rootControl=input(s.rootY);s.tipControl=input(s.tipY);s.gainControl=input(s.gain??1);row($('physics'),[s.part,s.groupControl,s.rootControl,s.tipControl,s.gainControl],()=>{physics.splice(physics.indexOf(s),1);physicsRows();});}
}
function number(e){const n=Number(e.value);if(e.value===''||!Number.isFinite(n))throw Error('请填写有效数值');return n;}
const bindingControls={};
async function load(){
 [config,assembly,model,feature]=await Promise.all([api('project'),fetch('assembly-v4.json').then(r=>r.json()),api('effective-model'),api('features')]);all=assembly.parts;
 $('engine').value=feature.engine;const f=model.expressionFace||{};
 for(const [side,label]of [['near','近侧'],['far','远侧']]){const box=document.createElement('div'),h=document.createElement('h3');h.textContent=label;box.append(h);for(const [kind,name]of [['ball','眼白'],['iris','虹膜'],['lid','眼睑／睫毛']])roleControls[side+'_'+kind]=field(box,name,partSelect(f.normalEyes?.[side]?.[kind]));$('eyeRoles').append(box);}
 for(const [key,label,value]of [['near_brow','近侧眉毛',model.browMotion?.ids?.near],['far_brow','远侧眉毛',model.browMotion?.ids?.far],['mouth','原始嘴部',f.originalMouth||model.parts.find(p=>p.node==='mouth')?.id]])roleControls[key]=field($('otherRoles'),label,partSelect(value));
 sprites=Object.entries(f.spriteRoles||{}).map(([id,r])=>({id,...r}));spriteRows();
 for(const [key,label]of Object.entries(faces)){
  const title=document.createElement('span');title.textContent=label;const controls=[];
  for(const slot of ['near','far','mouth']){
   const ids=Object.entries(f.assets||{}).filter(([id])=>{const role=f.spriteRoles?.[id];return role&&(slot==='mouth'?role.kind==='mouth':role.kind==='eye'&&role.side===slot);});
   const saved=f.bindings?.[key]?.[slot],s=select([['__auto','自动'],['__original','原部件'],...ids.map(([id])=>[id,id])],saved===undefined?'__auto':saved===null?'__original':saved);controls.push(s);(bindingControls[key]??={})[slot]=s;
  }row($('bindings'),[title,...controls]);
  const on=input('','checkbox');on.checked=model.browMotion?.dynamicExpressions?.includes(key)||false;const near=document.createElement('div'),far=document.createElement('div');near.className=far.className='row';const vals=[];
  for(let side=0;side<2;side++)for(let i=0;i<4;i++){const e=input(model.browMotion?.poses?.[key]?.[side]?.[i]??0);(side?far:near).append(e);vals.push(e);}const l=document.createElement('span');l.textContent=label;row($('brows'),[l,on,near,far]);browControls[key]={on,vals};
 }
 const sc=model.seatedLegs;seat=structuredClone(sc?.parts||[]);seatRows();$('seatedEnabled').checked=!!sc;
 for(const p of all)$('replaceIds').append(option(p.id,p.id));const replaces=sc?.replaceIds||model.parts.filter(p=>['legNear','legFar'].includes(p.node)).map(p=>p.id);for(const o of $('replaceIds').options)o.selected=replaces.includes(o.value);
 $('bodyDrop').value=(sc?.bodyDrop||0)/model.logo_scale;$('fadeStart').value=sc?.fadeRange?.[0]??.42;$('fadeEnd').value=sc?.fadeRange?.[1]??.78;$('dizzyHeadOnly').checked=!!model.motionOptions?.dizzyHeadOnly;
 physics=Object.entries(model.physics?.parts||{}).map(([id,p])=>({id,...p}));physicsRows();
 for(const [key,label]of Object.entries(groups)){const title=document.createElement('span');title.textContent=label;const values=(model.physics?.groups?.[key]||defaults[key]).map(v=>input(v));row($('physicsGroups'),[title,...values]);defaults[key]=values;}
 const [W,H]=model.canvas,C=model.center_x,np=id=>Array.isArray(model.nodes[id])?model.nodes[id]:model.nodes[id]?.pivot;
 const geo={headPivot:np('head')||[C,H*.5],headBounds:[H*.48,H*.58],upperBounds:[H*.52,H*.75],upperBowY:H*.53,gaze:np('eyes')||[C,H*.4],bubble:[C,H*.03],z:[W*.85,H*.13],tear:[C+W*.1,H*.41],headHit:np('head')||[C,H*.5],bodyHit:np('torso')||[C,H*.65],skirtCenter:C,browSplit:C,...model.motionGeometry};
 const labels={headPivot:'头部转动中心 X／Y',headBounds:'头部影响区 上缘／下缘',upperBounds:'上身影响区 上缘／下缘',upperBowY:'鞠躬上身锚点 Y',gaze:'视线锚点 X／Y',bubble:'气泡锚点 X／Y',z:'睡眠锚点 X／Y',tear:'眼泪锚点 X／Y',headHit:'头部点击中心 X／Y',bodyHit:'身体点击中心 X／Y',skirtCenter:'裙摆中心 X',browSplit:'眉毛分界 X'};
 for(const [key,label]of Object.entries(labels)){const wrap=document.createElement('div');wrap.className='row';const values=(Array.isArray(geo[key])?geo[key]:[geo[key]]).map(v=>input(v));values.forEach(e=>wrap.append(e));field($('geometry'),label,wrap);geometryControls[key]={values,array:Array.isArray(geo[key])};}
 roleControls.raisedArmPart=field($('geometry'),'挥手时置顶的部件（可空）',partSelect(geo.raisedArmPart));$('status').textContent='已读取保存配置。';
}
function captureRows(){
 for(const s of sprites)Object.assign(s,{id:s.part.value,kind:s.kindControl.value,state:s.stateControl.value.trim(),side:s.sideControl.value});
 for(const s of seat)Object.assign(s,{id:s.part.value,side:s.sideControl.value,groundOffset:number(s.offsetControl)});
 for(const s of physics)Object.assign(s,{id:s.part.value,group:s.groupControl.value,rootY:number(s.rootControl),tipY:number(s.tipControl),gain:number(s.gainControl)});
}
$('addSprite').onclick=()=>{captureRows();sprites.push({id:'',kind:'eye',state:'happy',side:'near'});spriteRows();};
$('addSeated').onclick=()=>{captureRows();seat.push({id:'',side:'Near',groundOffset:0});seatRows();};
$('addPhysics').onclick=()=>{captureRows();physics.push({id:'',group:'hair',rootY:0,tipY:model.canvas[1],gain:1});physicsRows();};
const loadImage=url=>new Promise((ok,bad)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>bad(Error('无法读取坐姿 PNG'));im.src=url;});
$('saveFeatures').onclick=async()=>{
 $('saveFeatures').disabled=true;
 try{
  captureRows();const f=structuredClone(model.expressionFace||{schema:3,assets:{},normalEyes:{},calibrationFacialIds:[]}),brow=structuredClone(model.browMotion||{});f.normalEyes={};brow.ids={};
  for(const side of ['near','far']){const eye=Object.fromEntries(['ball','iris','lid'].map(k=>[k,roleControls[side+'_'+k].value]));if(Object.values(eye).some(Boolean)){if(Object.values(eye).some(v=>!v))throw Error('该侧眼白、虹膜和眼睑需全部指定');f.normalEyes[side]=eye;}if(roleControls[side+'_brow'].value)brow.ids[side]=roleControls[side+'_brow'].value;}
  f.originalMouth=roleControls.mouth.value;f.assets={};f.spriteRoles={};const used=new Set();
  for(const s of sprites){if(!s.id||!s.state||used.has(s.id))throw Error('贴图部件及状态名称不能为空，部件不能重复');used.add(s.id);const p=all.find(p=>p.id===s.id);f.assets[s.id]={...(model.expressionFace?.assets?.[s.id]||{}),file:`parts/${s.id}.png`,box:[p.x,p.y,p.w,p.h],rotation:p.rot||0,z:p.z||0,hidden:false};f.spriteRoles[s.id]={kind:s.kind,state:s.state,...(s.kind==='eye'?{side:s.side}:{})};}
  f.bindings={};for(const [state,slots]of Object.entries(bindingControls))for(const [slot,e]of Object.entries(slots)){if(e.value==='__auto')continue;(f.bindings[state]??={})[slot]=e.value==='__original'?null:e.value;}
  f.calibrationFacialIds=[...new Set([...Object.values(f.normalEyes).flatMap(Object.values),...Object.values(brow.ids),f.originalMouth,...Object.keys(f.assets)].filter(Boolean))];
  brow.poses={...brow.poses};brow.dynamicExpressions=[];for(const [state,v]of Object.entries(browControls)){const values=v.vals.map(number);if(v.on.checked||brow.poses[state])brow.poses[state]=[values.slice(0,4),values.slice(4)];if(v.on.checked)brow.dynamicExpressions.push(state);}
  const ph={...model.physics,parts:{},groups:{}};for(const s of physics){if(!s.id||ph.parts[s.id]||s.tipY<=s.rootY)throw Error('物理部件须唯一，末端必须低于根部');ph.parts[s.id]={group:s.group,rootY:s.rootY,tipY:s.tipY,gain:s.gain};}
  for(const [k,controls]of Object.entries(defaults)){const v=controls.map(number);if(v.some(n=>n<=0))throw Error('物理弹性、阻尼和上限必须大于 0');ph.groups[k]=v;}
  let seatedLegs=null;if($('seatedEnabled').checked){const fade=[number($('fadeStart')),number($('fadeEnd'))];if(fade[0]<0||fade[1]>1||fade[0]>=fade[1])throw Error('渐变开始须小于完成，范围 0–1');const rows=[];for(const s of seat){if(!s.id||rows.some(r=>r.id===s.id))throw Error('请选择不重复的坐姿替换图');const p=all.find(p=>p.id===s.id),im=await loadImage(`parts/${encodeURIComponent(s.id)}.png`);const keep=structuredClone(model.seatedLegs?.parts?.find(q=>q.id===s.id)||{});rows.push({...keep,id:s.id,file:`parts/${s.id}.png`,side:s.side,box:[p.x,p.y,p.w,p.h],rotation:p.rot,z:p.z,source:keep.source||[0,0,im.naturalWidth,im.naturalHeight],groundOffset:s.groundOffset});}if(!rows.length)throw Error('请添加坐姿素材');seatedLegs={...model.seatedLegs,parts:rows,replaceIds:[...$('replaceIds').selectedOptions].map(o=>o.value),bodyDrop:$('bodyDrop').value===String((model.seatedLegs?.bodyDrop||0)/model.logo_scale)?(model.seatedLegs?.bodyDrop||0):number($('bodyDrop'))*model.logo_scale,fadeRange:fade,floor:256};}
  const geo={...model.motionGeometry};for(const [key,{values,array}]of Object.entries(geometryControls)){const v=values.map(number);geo[key]=array?v:v[0];}geo.raisedArmPart=roleControls.raisedArmPart.value;
  await api('features',{engine:$('engine').value,expressionFace:f,browMotion:brow,physics:ph,seatedLegs,motionGeometry:geo,motionOptions:{...model.motionOptions,dizzyHeadOnly:$('dizzyHeadOnly').checked}});$('status').textContent='已保存。打开表情与眨眼继续摆位，或重载动作预览。';
 }catch(e){$('status').textContent='未保存：'+e.message;}finally{$('saveFeatures').disabled=false;}
};
load().catch(e=>$('status').textContent=e.message);
