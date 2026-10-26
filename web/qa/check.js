import * as kit from '/vendor/kit/body.js';
import {createExpressionFace} from './reference-face.js';
const built=await(await fetch('/api/preview?project=xitelali-2-1-0',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
const root=new URL(built.base,location.origin),get=async p=>(await fetch(new URL(p,root))).json();
const {createRigBody}=await import(new URL('figure.js',root));
const model=await get('model.json'),assembly=await get('art-source/saved-expression-assembly.json');
const labels=Object.fromEntries(Object.keys(kit.FACES).map(key=>[key,{name:key}]));
const project={source:{expressionVariantIds:Object.keys(model.expressionFace.assets),expressionGroups:labels}};
const originalRoot=new URL('/p/xitelali-2-1-0/source-pack/',location.origin);
const errors=[],report={passed:false,errors,sourceSha256:model.expressionFace.sourceSha256,expressions:[],transitions:[],bodyCases:[],standaloneEntry:false};
const status=t=>document.querySelector('#status').textContent=t,assert=(ok,text)=>{if(!ok)errors.push(text);},hostRoot=document.querySelector('#host');
const imageCache=new Map(),loadImage=url=>{url=String(url);if(!imageCache.has(url))imageCache.set(url,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('PNG failed: '+url));im.src=url;}));return imageCache.get(url);};
const frames=[],clamp=v=>Math.max(0,Math.min(1,v)),rad=Math.PI/180,S=model.logo_scale,X=x=>128+(x-model.center_x)*S,Y=y=>256+(y-model.feet_y)*S;
const focusedBodies=new URLSearchParams(location.search).get('body');
function differences(a,b,path='',out=[]){if(out.length>=8||a===b)return out;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[key],b[key],path+'.'+key,out);}else out.push({path,a,b});return out;}
function seeded(){let seed=381729;return()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);}
async function bodyWith(factory,spec=model){
 let rig,state,rigModel,last,draw;
 const wrapped={...kit,createRig:(cv,m)=>{rigModel=m;rig=kit.createRig(cv,m);return{...rig,upload:(id,im)=>{uploads.set(id,im);return rig.upload(id,im);},render:s=>{state=s;return rig.render(s);}};},createBody:(host,{figure,...rest})=>{draw=figure.draw;figure.draw=(g,face,f)=>{last={g,face,f};return draw(g,face,f);};return kit.createBody(host,{figure,...rest});}};
 const uploads=new Map(),body=await factory(spec===model?root:originalRoot,{kit:wrapped,model:spec,host:{root:hostRoot,bounds:()=>({W:1100,H:850,floorY:836,S:3.2}),start:{x:550,enter:'stand'}},loadImage});body.set({roam:'off',hold:999});body.step(1/60);
 return{body,uploads,get rig(){return rig;},get state(){return state;},get rigModel(){return rigModel;},get last(){return last;},draw:(face,f)=>draw(last.g,face,f)};
}
function rawPoint(spec,u,v){const [x,y,w,h]=spec.box,cx=x+w/2,cy=y+h/2,a=(spec.rotation||spec.rot||0)*rad,dx=w*(u-.5),dy=h*(v-.5);return[cx+Math.cos(a)*dx-Math.sin(a)*dy,cy+Math.sin(a)*dx+Math.cos(a)*dy];}
function nodePoint(q,node,pivot){
 if(node?.fn){const d=node.fn(0,0,...q);return[q[0]+d[0],q[1]+d[1]];}
 const a=(node?.a||0)*rad,dx=(q[0]-pivot[0])*(node?.sx??node?.s??1),dy=(q[1]-pivot[1])*(node?.sy??node?.s??1);
 return[pivot[0]+(node?.tx||0)+Math.cos(a)*dx-Math.sin(a)*dy,pivot[1]+(node?.ty||0)+Math.sin(a)*dx+Math.cos(a)*dy];
}
const variants=new Set(project.source.expressionVariantIds),refs=new Map();
async function reference(key){
 if(refs.has(key))return refs.get(key);
 const rows=new Map(assembly.expressionLayouts[key].parts.map(p=>[p.id,{...p,box:[p.x,p.y,p.w,p.h],rotation:p.rot}]));
 const parts=model.parts.map(p=>rows.has(p.id)?{...p,...rows.get(p.id),rot:rows.get(p.id).rotation}:p),assets=Object.fromEntries(Object.entries(model.expressionFace.assets).map(([id,p])=>[id,{...p,...rows.get(id)}]));
 const textures=new Map(await Promise.all(parts.map(async p=>[p.id,await loadImage(new URL(p.file,root))]))),uploads=new Map(),rig={upload:(id,im)=>uploads.set(id,im)};
 const engine=await createExpressionFace({doc:document,model:{...model,parts,expressionFace:{...model.expressionFace,assets}},load:file=>loadImage(new URL(file,root)),parts:[],defs:{},textures,X,Y});
 const ref={engine,rows,uploads,rig,assets,update:(key,progress=1,t=0)=>{const state={alpha:{}};const face=kit.FACES[key].f(0),result=engine.update({f:{face:key,mode:'idle',t,eyeClose:0,expressionProgress:progress},face,blink:0,look:[0,0],talk:0,dt:10},state,rig);return{state,result};}};refs.set(key,ref);return ref;
}
function pixels(im){if(!im)return null;const cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;cv.getContext('2d').drawImage(im,0,0);return cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;}
function verifyGeometry(env,ref,r,key){
 let maxError=0,layerErrors=0,alphaErrors=0,checked=0;
 for(const id of model.expressionFace.calibrationFacialIds){
  const special=variants.has(id),meshId=special?'expression:'+id:id,mesh=env.rigModel.parts.find(p=>p.id===meshId),pose=ref.rows.get(id);if(!mesh||!pose)continue;
  const active=special?(r.state.alpha[meshId]??0):id==='part_2'?(r.result.mouth?0:1):(r.state.alpha[id]??1);
  const expectedAlpha=pose.hidden?0:active;
  if(Math.abs((env.state.alpha[meshId]??1)-expectedAlpha)>1e-8)alphaErrors++;
  if((env.state.z[meshId]??mesh.z)!==pose.z)layerErrors++;
  if(expectedAlpha<.001)continue;
  for(const [u,v]of [[0,0],[1,0],[1,1],[0,1],[.5,.5]]){
   const [bx,by,bw,bh]=mesh.box,actual=env.rig.point(mesh.parent,env.state,bx+bw*u,by+bh*v);
   let q;
   if(special){const node=r.state[meshId]||{},[x,y,w,h]=pose.box,cx=X(x+w/2),cy=Y(y+h/2);q=nodePoint([X(x+w*u),Y(y+h*v)],node,[cx,cy]);}
   else{const master=rawPoint(pose,u,v);q=[X(master[0]),Y(master[1])];if(['part_23','part_24','part_25','part_26','part_27','part_28'].includes(id))q=nodePoint(q,r.state['eye:'+id],[X(pose.x+pose.w/2),Y(pose.y+pose.h/2)]);}
   const expected=env.rig.point('head',env.state,...q);maxError=Math.max(maxError,Math.hypot(expected[0]-actual[0],expected[1]-actual[1]));checked++;
  }
 }
 assert(maxError<1e-7,key+': saved facial geometry changed '+maxError);assert(layerErrors===0,key+': saved layer order changed');assert(alphaErrors===0,key+': face visibility changed');
 let textureDifferences=0;
 for(const id of ['part_23','part_24','part_25','part_26']){
  if((env.state.alpha[id]??1)<.001)continue;const actual=pixels(env.uploads.get(id)),expected=pixels(ref.uploads.get(id));if(!actual||!expected||actual.length!==expected.length){textureDifferences++;continue;}for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])textureDifferences++;
 }
 assert(textureDifferences===0,key+': eye mask pixels differ from studio '+textureDifferences);
 return{key,maxError,checked,layerErrors,alphaErrors,textureDifferences};
}
function card(env,key){
 const cv=document.createElement('canvas');cv.width=855;cv.height=660;const source=env.body.rigCanvas,view=env.rig.view;
 const x=(X(380)-view[0])/(view[2]-view[0])*source.width,y=(Y(360)-view[1])/(view[3]-view[1])*source.height,w=520*S/(view[2]-view[0])*source.width,h=400*S/(view[3]-view[1])*source.height;
 cv.getContext('2d').drawImage(source,x,y,w,h,0,0,cv.width,cv.height);const article=document.createElement('article'),title=document.createElement('h3');title.textContent=project.source.expressionGroups[key].name;article.append(title,cv);document.querySelector('#cards').append(article);
}
function bodySnapshot(env,spec){const v=env.body.visualState();return{state:Object.fromEntries(['mode','seat','seatedAlpha','seatedGeometry','dizzyBodyFixed','lifeAngle','lifeDip','breath','arms','legs','footLift','footBottom','headAngle','upperLean','groupRot','walkK','runK','secondary'].map(k=>[k,v[k]])),geometry:spec.parts.filter(p=>!['eyes','iris','mouth','brow'].includes(p.node)).map(p=>({id:p.id,alpha:env.state.alpha[p.id]??1,points:[[p.box[0],p.box[1]],[p.box[0]+p.box[2],p.box[1]+p.box[3]]].map(([x,y])=>env.rig.point('rest:'+p.id,env.state,X(x),Y(y)))}))};}
function blinkPoint(spec,u,v){return rawPoint(spec,u,v).map((p,i)=>i?Y(p):X(p));}
function opaque(im){const data=pixels(im);let n=0;for(let i=3;i<data.length;i+=4)if(data[i]>128)n++;return n;}
async function blinkAndTracking(env,baseFrame,startTime){
 let t=startTime;report.blink=[];report.headTracking=false;assert(!model.headTracking&&!model.tune.headTracking,'new head tracking config still present');
 for(const blink of [0,.1,.25,.5,.75,.9,.98,1,0]){
  t+=.05;env.draw(kit.FACES.neutral.f(0),{...baseFrame,face:'neutral',t,blink,look:[0,0]});
  const frame={blink,eyes:{}};
  for(const [side,id]of [['near','part_28'],['far','part_27']]){
   const mesh=env.rigModel.parts.find(p=>p.id===id),[x,y,w,h]=mesh.box,ids=model.expressionFace.normalEyes[side];let endpointError=0;
   if(blink===0||blink===1){const target=model.expressionFace.blinkCalibration[side][blink===0?'start':'end'];for(const [u,v]of [[0,0],[1,0],[1,1],[0,1]]){const actual=env.rig.point(mesh.parent,env.state,x+w*u,y+h*v),expected=env.rig.point('head',env.state,...blinkPoint(target,u,v));endpointError=Math.max(endpointError,Math.hypot(actual[0]-expected[0],actual[1]-expected[1]));}assert(endpointError<1e-7,'blink '+side+' endpoint does not equal saved calibration');}
   const count=opaque(env.uploads.get(ids.ball))+opaque(env.uploads.get(ids.iris));frame.eyes[side]={opaque:count,endpointError};
   if(blink===1)assert(count===0,'full ordinary blink leaves eye pixels');
   if(blink===0)assert(env.uploads.get(ids.ball).tagName==='IMG'&&env.uploads.get(ids.iris).tagName==='IMG','blink reopening does not restore original PNG');
  }
  report.blink.push(frame);
 }
 for(const side of ['near','far']){for(let i=1;i<8;i++)assert(report.blink[i].eyes[side].opaque<=report.blink[i-1].eyes[side].opaque,'ordinary blink aperture is not monotonic '+side);assert(report.blink[8].eyes[side].opaque===report.blink[0].eyes[side].opaque,'reopened pixels changed '+side);}

 assert(!env.body.visualState().headTracking,'new head tracking still active');

}
try{
 status('正在加载 19 个保存布局…');const random=Math.random;Math.random=seeded();const env=await bodyWith(createRigBody);Math.random=random;let t=env.last.f.t,baseFrame={...env.last.f,mode:'idle',eyeClose:0,blink:0,look:[0,0],talk:0};
 for(const key of (focusedBodies?[]:Object.keys(assembly.expressionLayouts))){
  status('逐层核对：'+project.source.expressionGroups[key].name);
  const ref=await reference(key);
  for(let i=0;i<40;i++){t+=.05;env.draw(kit.FACES[key].f(0),{...baseFrame,face:key,t,expressionProgress:1});}
  const r=ref.update(key,1,t);
  report.expressions.push(verifyGeometry(env,ref,r,key));card(env,key);await new Promise(resolve=>setTimeout(resolve,0));
 }
 for(const key of (focusedBodies?[]:Object.keys(assembly.authoredLashTransitions))){
  const ref=await reference(key);for(const progress of [0,.25,.5,.75,1]){t+=.05;const r=ref.update(key,progress,t);env.draw(kit.FACES[key].f(0),{...baseFrame,face:key,t,expressionProgress:progress});report.transitions.push({...verifyGeometry(env,ref,r,key),progress});}
 }
 if(!focusedBodies){status('日常眨眼端点、逐渐闭合与取消头部追踪检查…');await blinkAndTracking(env,baseFrame,t);}
 env.body.pointer('leave');env.body.do('neutral');env.body.step(1/60);const before=JSON.stringify(env.body.visualState());for(let i=0;i<3;i++)env.body.step(0);report.pauseStable=before===JSON.stringify(env.body.visualState());assert(report.pauseStable,'paused redraw changes state');env.body.dispose();hostRoot.replaceChildren();refs.clear();
 const baselineModule=await import(new URL('figure.js',originalRoot)),baselineModel=await (await fetch(new URL('model.json',originalRoot))).json();
 for(const word of (focusedBodies?focusedBodies.split(','):['sit','sleep','dizzy','stand','walk','run','jump','wave','bow'])){
  status('身体动作与渐变对照：'+word);const samples=[];
  for(const [factory,spec]of [[baselineModule.createRigBody,baselineModel],[createRigBody,model]]){
   Math.random=seeded();const env=await bodyWith(factory,spec);env.body.do(word);let at=0;const frames=[];
   for(const point of [.1,.4,.6,.9]){while(at<point-1e-9){const dt=Math.min(1/60,point-at);env.body.step(dt);at+=dt;}frames.push(bodySnapshot(env,spec));}
   samples.push(frames);env.body.dispose();hostRoot.replaceChildren();Math.random=random;await new Promise(resolve=>setTimeout(resolve,0));
  }
  const equal=JSON.stringify(samples[0])===JSON.stringify(samples[1]);assert(equal,word+': body / sit fade / dizzy changed');report.bodyCases.push({word,equal,differences:equal?[]:differences(samples[0],samples[1])});
 }
 const blob=new Blob([await(await fetch(new URL('figure.js',root))).text()],{type:'text/javascript'}),url=URL.createObjectURL(blob);const entry=await import(url);URL.revokeObjectURL(url);report.standaloneEntry=typeof entry.createRigBody==='function';assert(report.standaloneEntry,'standalone entry does not load');
 report.passed=errors.length===0;status(report.passed?'检查通过：19 表情保存几何／层级／遮罩，四项起终点、9 项身体动作与渐变、独立入口。':'检查未通过：'+errors.join('; '));
 document.querySelector('#report').textContent=JSON.stringify(report,null,2);document.body.dataset.ready='true';document.body.dataset.passed=String(report.passed);
}catch(error){errors.push(String(error));status('检查出错：'+error.message);document.querySelector('#report').textContent=JSON.stringify(report,null,2);document.body.dataset.ready='true';document.body.dataset.passed='false';console.error(error);}
