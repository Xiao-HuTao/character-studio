/** Xitelali seated legs: preserve the original upper body, clothes, hands and head.
 * Original 0.0.7 PNGs and placement are retained; continuous mesh fields keep cut edges together.
 */
export async function createRigBody(base, opts) {
  const {kit, model, host} = opts, doc = host.root.ownerDocument;
  const NS='http://www.w3.org/2000/svg', rad=Math.PI/180;
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
  const smooth=(a,b,x)=>{const k=clamp((x-a)/(b-a));return k*k*(3-2*k);};
  const lerp=(a,b,k)=>a+(b-a)*k;
  const motion={},springs={};
  const follow=(key,target,rate,dt)=>motion[key]=lerp(motion[key]??0,target,1-Math.exp(-rate*dt));
  // Exact critically damped response: stable at different frame rates and on repeated paused redraws.
  const settle=(key,target,rate,dt)=>{
    const s=springs[key]??={x:0,v:0},d=s.x-target,j=s.v+rate*d,e=Math.exp(-rate*dt);
    s.x=target+(d+j*dt)*e;s.v=(s.v-rate*j*dt)*e;return s.x;
  };
  const cloth={},secondary={hair:{x:0,y:0},bangs:{x:0,y:0},ribbon:{x:0,y:0},skirt:{x:0,y:0}};
  let previousRoot=null,previousAngle=null;
  // Secondary motion may overshoot; small integration steps and travel limits keep the mesh bounded.
  const elastic=(key,target,rate,damping,limit,dt)=>{
    const s=cloth[key]??={x:0,v:0},n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
    for(let i=0;i<n;i++){
      s.v+=((target-s.x)*rate*rate-2*damping*rate*s.v)*h;
      s.x+=s.v*h;
      if(Math.abs(s.x)>limit){s.x=clamp(s.x,-limit,limit);if(s.x*s.v>0)s.v=0;}
    }
    return s.x;
  };
  const X=x=>128+(x-model.center_x)*model.logo_scale;
  const Y=y=>256+(y-model.feet_y)*model.logo_scale;
  const browConfig=model.browMotion||{},browNow={near:[0,0,0,0],far:[0,0,0,0]};
  const browSide=Object.fromEntries(Object.entries(browConfig.ids||{}).map(([side,id])=>[id,side]));
  let browTalkAt=-Infinity,browWasTalking=false;
  const browVisual={};
  const url=p=>opts.asset?String(opts.asset(p)):new URL(p,base).href;
  const load=p=>opts.loadImage?opts.loadImage(url(p)):new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Cannot load '+p));im.src=url(p);});
  const parts=[],defs={root:{kind:'warp',rect:[-80,-80,330,300]},upper:{kind:'warp',rect:[-80,-80,330,300],parent:'root'},headCarrier:{kind:'warp',rect:[-80,-80,330,300]},head:{kind:'warp',rect:[-80,-80,330,300],parent:'headCarrier'},hair:{kind:'warp',rect:[-80,-80,330,300],parent:'head'}};
  const textures=new Map();
  const rot=(id,pivot,parent)=>{defs[id]={kind:'rot',pivot:[X(pivot[0]),Y(pivot[1])],parent};};
  rot('armNear',model.nodes.armNear,'upper');rot('armFar',model.nodes.armFar,'upper');
  for(const side of ['Near','Far'])defs['leg'+side]={kind:'warp',parent:'root',rect:[-80,-80,330,300]};
  for(const p of model.parts){
    const [x,y,w,h]=p.box,local='rest:'+p.id;
    let parent=['head','eyes','iris','brow','mouth'].includes(p.node)?'head':p.node==='hair'?'hair':p.node==='torso'?'upper':p.node;
    if(p.node==='eyes'||p.node==='iris'){
      const eye='eye:'+p.id;rot(eye,[x+w/2,y+h/2],'head');parent=eye;
    }
    if(p.node==='mouth'){rot('mouth',[x+w/2,y+h/2],'head');parent='mouth';}
    if(p.node==='brow'){
      rot('brow:'+p.id,[x+w/2,y+h/2],'head');parent='brow:'+p.id;
      if(browSide[p.id]){const shape='browShape:'+p.id;defs[shape]={kind:'warp',parent,rect:[X(x),Y(y),X(x+w),Y(y+h)]};parent=shape;}
    }
    if(model.physics?.parts?.[p.id]){
      const node='follow:'+p.id;defs[node]={kind:'warp',parent:parent||'root',rect:[-90,-90,330,300]};parent=node;
    }
    rot(local,[x+w/2,y+h/2],parent||'root');
    parts.push({id:p.id,tex:p.id,parent:local,z:p.z,box:[X(x),Y(y),w*model.logo_scale,h*model.logo_scale],grid:[12,16]});
    textures.set(p.id,await load(p.file));
  }
  const seated=model.seatedLegs;
  const standingLegIds=model.parts.filter(p=>['legNear','legFar'].includes(p.node)).map(p=>p.id);
  for(const spec of seated?.parts||[]){
    const im=await load(spec.file),[sx,sy,sw,sh]=spec.source,c=doc.createElement('canvas');
    c.width=sw;c.height=sh;c.getContext('2d').drawImage(im,sx,sy,sw,sh,0,0,sw,sh);textures.set(spec.id,c);
    const node='seated:'+spec.side;defs[node]={kind:'warp',rect:[-90,-90,330,300]};
    const [x,y,w,h]=spec.box;
    parts.push({id:spec.id,tex:spec.id,parent:node,z:spec.z,box:[X(x),Y(y),w*model.logo_scale,h*model.logo_scale],grid:[12,16]});
  }
  const expressionFace=await createCalibratedExpressionFace({doc,model,load,parts,defs,textures,X,Y});
  const rigModel={view:[-90,-90,330,300],parts,deformers:defs};
  let native,rig,mounted,canvas,lastT,pxScale=0,phase=0,pending=null,disposed=false,visual={},extent=[20,0,200,258];
  let dizzyBodyFixed=false,dizzyFacing=1,bodyComp={x:1,y:1},frameLow=0;
  const compensated=(x,y)=>[128+(x-128)*bodyComp.x,256+(y-256)*bodyComp.y];
  function fixDizzyScale(g){
    if(!dizzyBodyFixed){bodyComp={x:1,y:1};canvas.parentNode.removeAttribute('transform');return;}
    const matrix=g.transform.baseVal.consolidate()?.matrix,S=host.bounds().S||1;
    bodyComp=matrix?{x:S*dizzyFacing/matrix.a,y:S/matrix.d}:{x:1,y:1};
    if(!Number.isFinite(bodyComp.x)||!Number.isFinite(bodyComp.y))bodyComp={x:1,y:1};
    canvas.parentNode.setAttribute('transform',`translate(128 256) scale(${bodyComp.x} ${bodyComp.y}) translate(-128 -256)`);
  }
  function projectedAnchors(){
    if(!dizzyBodyFixed)return anchors;
    const result={};
    for(const [key,p]of Object.entries(anchors)){
      if(key==='hearts'){
        const a=compensated(p[0],p[2]+frameLow),b=compensated(p[1],p[2]+frameLow);
        result[key]=[a[0],b[0],a[1]-frameLow];
      }else{
        const low=['bubble','z','tear'].includes(key)?frameLow:0,q=compensated(p[0],p[1]+low);
        result[key]=[q[0],q[1]-low];
      }
    }
    return result;
  }
  const legParts=Object.fromEntries(['Near','Far'].map(side=>[side,model.parts.find(p=>p.node==='leg'+side)]));
  const anchors={gaze:[X(676),Y(576)],bubble:[128,0],z:[180,35],tear:[X(760),Y(620)],hearts:[110,145,35]};
  let hits=[[X(626),Y(500),60],[128,180,48]];
  function mount(g){
    rig?.dispose();g.replaceChildren();const fo=doc.createElementNS(NS,'foreignObject');
    const [x0,y0,x1,y1]=rigModel.view;for(const [k,v]of Object.entries({x:x0,y:y0,width:x1-x0,height:y1-y0}))fo.setAttribute(k,v);
    canvas=doc.createElement('canvas');canvas.width=1008;canvas.height=936;canvas.style.cssText='width:100%;height:100%;display:block';fo.append(canvas);g.append(fo);
    rig=kit.createRig(canvas,rigModel);for(const [id,im]of textures)rig.upload(id,im);mounted=g;pxScale=0;
  }
  function fitCanvas(){
    const m=(dizzyBodyFixed?canvas.parentNode:mounted).getScreenCTM();if(!m)return;
    // Follow the screen and its pixel density, with the same 1.25x oversampling and 6x cap as whale.
    // Use the vertical axis so turning through a horizontally squeezed pose keeps a sharp buffer.
    const k=Math.min(6,Math.hypot(m.c,m.d)*(doc.defaultView?.devicePixelRatio||1)*1.25);
    if(!Number.isFinite(k)||k<=0||Math.abs(k-pxScale)/(pxScale||1)<.08)return;
    pxScale=k;
    const [x0,y0,x1,y1]=rigModel.view;
    const w=Math.max(16,Math.round((x1-x0)*k)),h=Math.max(16,Math.round((y1-y0)*k));
    if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
  }
  const figure={colors:{z:model.accent},gestures:['nod','shake','wave','bow','flap'],
    get extent(){if(!dizzyBodyFixed)return extent;const a=compensated(extent[0],extent[1]),b=compensated(extent[2],extent[3]);return[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];},
    get hits(){return dizzyBodyFixed?hits.map(([x,y,r])=>[...compensated(x,y),r]):hits;},get anchors(){return projectedAnchors();},
    groupTilt(mode,tilt,lean){return mode==='dizzy'?0:tilt*(motion.groupTilt??0)+lean*(motion.groupLean??0);},
    draw(g,face,f){
      if(disposed)return;if(mounted!==g)mount(g);
      const dt=lastT===undefined?1/60:clamp(f.t-lastT,0,.05);lastT=f.t;
      const tv=(m,k,d=1)=>Number.isFinite(model.tune?.[m]?.[k])?model.tune[m][k]:d;
      const mode=f.mode,walk=['walk','run'].includes(mode),run=mode==='run',dance=mode==='dance',held=mode==='drag',air=mode==='air';
      const dizzy=mode==='dizzy';
      if(dizzy&&!dizzyBodyFixed)dizzyFacing=Math.sign(f.facing||1);
      dizzyBodyFixed=dizzy;fixDizzyScale(g);fitCanvas();frameLow=f.low||0;
      const walkK=follow('walk',walk?1:0,10,dt),runK=follow('run',run?1:0,9,dt);
      const danceK=follow('dance',dance?1:0,10,dt),dragK=follow('drag',held?1:0,14,dt),airK=follow('air',air?1:0,14,dt);
      const whole=['air','drag','crouch','land','dizzy'].includes(mode);
      follow('groupTilt',whole?1:dance?.3:walk?1:0,10,dt);
      follow('groupLean',whole?1:run?.85:walk?.7:0,10,dt);
      if(dance)phase+=dt*6.8;
      const kind=f.gesture?.kind,k=clamp(f.gesture?.k||0),env=Math.sin(Math.PI*k);
      const wave=kind==='wave'?smooth(0,.22,k)*(1-smooth(.8,1,k)):0;
      const nod=kind==='nod'?Math.abs(Math.sin(k*Math.PI*2))*env:0;
      const shake=kind==='shake'?Math.sin(k*Math.PI*6)*env:0;
      const bow=kind==='bow'?Math.pow(env,.8):0;
      const flap=kind==='flap'?Math.sin(k*Math.PI*8)*env:0;
      const seatProgress=follow('seat',['sit','sleep','dizzy','wake'].includes(mode)?clamp(f.sit):0,16,dt);
      // Keep the original opacity timeline. Settle the pose smoothly by the end of the crossfade.
      const seat=dizzy?lerp(seatProgress,1,smooth(.42,.78,seatProgress)):seatProgress;
      const look=f.look||[0,0],facing=Math.sign(f.facing||1);
      const alive=seat*tv('sitLife','head'),emotion=seat*tv('sitLife','expression');
      const moods={happy:-1.8,wink:-2,love:1.5,shy:2.4,worried:1.2,sad:2.2,sleepy:2.6,thinking:-1.5,smug:-1.6,excited:-1.4,confused:3,angry:-1,scared:1.2};
      const lifeAngle=alive*(Math.sin(f.t*1.23)*.65+look[0]*.18+(f.talk||0)*Math.sin(f.t*7)*.35)+(moods[f.face]||0)*emotion;
      const lifeDip=alive*(mode==='sleep'?Math.sin(f.t*1.15)*.35:Math.sin(f.t*2.1)*.12)+(f.face==='shy'||f.face==='sad'?emotion*.35:0);
      const breath=dizzy?0:seat*tv('sitLife','breath')*Math.sin(f.t*(mode==='sleep'?1.55:2.1))*.28;
      // Counter only a small part of grounded leaning, so the face stays readable while the body leans.
      const counter=-clamp((f.groupRot||0)*facing,-12,12)*.4*(1-dragK)*(1-airK);
      const headTarget=Math.sin(f.t*.7)*.65*tv('idle','sway')+nod*5+shake*2-wave*2*tv('wave','head')+danceK*3*tv('dance','head')*Math.sin(phase*.5)+(mode==='sleep'?4:0)+counter+lifeAngle+(dizzy?clamp(f.tilt*facing,-10,10):0);
      const headAngle=settle('headAngle',headTarget,20,dt)*rad;
      const headDx=settle('headDx',clamp(look[0],-8,8)*.08*tv('idle','head')+shake*1.6,22,dt);
      const headDip=settle('headDip',nod*.8+lifeDip,24,dt);
      const upperLean=settle('upperLean',bow*7*tv('bow','angle')+runK+(f.lean||0)*facing*.1,20,dt);
      const upperBow=follow('bow',bow,18,dt);
      const layout=native?.layout(),scale=host.bounds().S||1;
      const root=layout?{y:layout.side.y,scale}:null;
      const angle=headAngle/rad+(f.groupRot||0)*facing;
      let vertical=0,angular=0;
      if(dt>0){
        // Ignore resizing and manual placement; normal jumps and landings stay within this travel bound.
        if(root&&previousRoot&&Math.abs(scale-previousRoot.scale)<.01&&Math.abs(root.y-previousRoot.y)/scale<60)
          vertical=clamp((root.y-previousRoot.y)/scale/dt,-1200,1200);
        if(previousAngle!==null)angular=clamp((angle-previousAngle)/dt,-180,180);
        previousRoot=root;previousAngle=angle;
      }
      const vy=follow('clothVertical',vertical,18,dt),turn=follow('clothTurn',angular,22,dt);
      const sway=clamp((f.swing||0)/26,-1.4,1.4),stride=(motion.gaitNear||0)-(motion.gaitFar||0);
      const targets={
        hair:[sway*2.6-turn*.025+stride*.025+Math.sin(f.t*1.4)*.12,-vy*.0035],
        bangs:[sway*.55-turn*.009,-vy*.0009],
        ribbon:[sway*2.1-turn*.019+stride*.02,-vy*.0022],
        skirt:[sway*.65+stride*.018,-vy*.0015]
      };
      const settings={hair:[8,.62,4,3.2],bangs:[13,.82,1.1,.9],ribbon:[10,.55,3.2,2.4],skirt:[12,.8,1.2,1.1]};
      for(const [name,[rate,damping,maxX,maxY]]of Object.entries(settings)){
        const tune=name+'Physics',strength=clamp(tv(tune,'strength'),0,4),r=rate*Math.sqrt(clamp(tv(tune,'stiffness'),.35,4)),d=damping*clamp(tv(tune,'damping'),.25,4);
        // Strength scales the output, so zero disables the effect immediately, including residual oscillation.
        secondary[name]={x:clamp(elastic(name+'X',targets[name][0],r,d,maxX,dt)*strength,-maxX,maxX),y:clamp(elastic(name+'Y',targets[name][1],r,d,maxY,dt)*strength,-maxY,maxY)};
      }
      const st={alpha:{},z:{}};
      for(const [id,p]of Object.entries(model.physics?.parts||{})){
        const s=secondary[p.group];if(!s)continue;
        st['follow:'+id]={fn:(u,v,x,y)=>{
          if(dizzy)return[0,0];
          const w=smooth(Y(p.rootY),Y(p.tipY),y)**2,gain=p.gain*(p.group==='skirt'?1-seat*.85:1);
          // Skirt layers share one field in master coordinates, preserving their overlap at the waist.
          const flare=p.group==='skirt'?s.y*(x-X(650))*.006:0;
          return[(s.x+flare)*w*gain,s.y*w*w*gain];
        }};
      }
      st.root={fn:(u,v,px,py)=>{
        // Move the retained body as one piece; do not compress the original skirt or torso.
        return[0,seat*(seated?.bodyDrop??0)];
      }};
      st.upper={fn:(u,v,px,py)=>{
        if(dizzy)return[0,0];
        const w=1-smooth(Y(790),Y(1130),py);
        const breath=Math.sin(f.t*Math.PI*1.1)*.003*tv('idle','breath');
        return[upperLean*w,Math.max(0,Y(800)-py)*.045*upperBow*w+(py-256)*breath*w];
      }};
      st.headCarrier={fn:(u,v,px,py)=>{
        const original=rig.point('upper',st,px,py);
        return[original[0]-px,original[1]-py+breath];
      }};
      st.head={fn:(u,v,px,py)=>{
        const w=dizzy?1:1-smooth(Y(735),Y(870),py),dx=px-X(626),dy=py-Y(765);
        return[((Math.cos(headAngle)-1)*dx-Math.sin(headAngle)*dy+headDx)*w,(Math.sin(headAngle)*dx+(Math.cos(headAngle)-1)*dy+headDip)*w];
      }};
      const closed=['sleep','squeeze','bowing'].includes(f.face)||mode==='sleep';
      const blink=Math.max(f.blink||0,f.eyeClose||0,closed?1:0,bow*.98);
      const talk=f.talk||0;
      const faceState=expressionFace.update({f,face,blink,look,talk,dt},st,rig);
      const symbols=faceState.eyes,mouth=faceState.mouth;
      st.mouth=faceState.calibrated?{}:{sx:1+talk*.12,sy:1+talk*.45};
      const browPose=browConfig.poses?.[f.face],talking=!!browPose&&talk>.2&&!['dizzy','flustered','dragged'].includes(f.face);
      if(talking&&(!browWasTalking||f.t-browTalkAt>2.8))browTalkAt=f.t;
      browWasTalking=talking;
      const browFlash=!!browPose&&!['dizzy','flustered','dragged'].includes(f.face)?Math.sin(Math.PI*clamp((f.t-browTalkAt)/.45))**2*(browConfig.talkLift||0):0;
      for(const p of model.parts){
        st['rest:'+p.id]={a:p.rot||0};
        // Original eye layer visibility and eyelid motion are managed by expressionFace.
        if(p.node==='mouth')st.alpha[p.id]=mouth?0:1;
        if(p.node==='brow'){
          if(faceState.calibrated){
            st['brow:'+p.id]={};st['browShape:'+p.id]={fn:()=>[0,0]};
            const side=browSide[p.id];if(side)browVisual[side]={id:p.id,enabled:false,calibrated:true,preset:faceState.layout};
            continue;
          }
          const near=p.box[0]<680,angry=['angry','determined'].includes(f.face),sad=['sad','worried','cry'].includes(f.face);
          const legacy={a:(angry?6:sad?-4:0)*(near?1:-1),ty:angry?1:sad?-1:0};
          const side=browSide[p.id];
          if(!side){st['brow:'+p.id]=legacy;continue;}
          const state=browNow[side],sign=side==='near'?1:-1,width=p.box[2],scale=model.logo_scale;
          if(!browPose){
            // Deferred expressions keep their exact previous eyebrow pose as well as their eyes.
            state[0]=-legacy.ty/scale;state[1]=Math.tan(-legacy.a*sign*rad)*width;state[2]=state[3]=0;
            st['brow:'+p.id]=legacy;
          }else{
            const target=[...browPose[side==='near'?0:1]],limits=browConfig.limits||{},rate=browConfig.rates?.[f.face]||9;
            target[0]+=browFlash-(symbols[side]?0:(1-faceState.eyelids[side].open)*(browConfig.blinkDrop||0));
            const bounds=[limits.lift||20,limits.innerRise||18,limits.curve||3,limits.inward||3];
            for(let i=0;i<4;i++)state[i]=lerp(state[i],clamp(target[i],-bounds[i],bounds[i]),1-Math.exp(-rate*(i?.8:1)*dt));
            st['brow:'+p.id]={a:-sign*Math.atan2(state[1],width)/rad,tx:sign*state[3]*scale,ty:-state[0]*scale};
          }
          const bend=state[2]*scale;
          st['browShape:'+p.id]={fn:u=>[0,-bend*4*clamp(u)*(1-clamp(u))]};
          browVisual[side]={id:p.id,enabled:!!browPose,lift:state[0],innerRise:state[1],curve:state[2],inward:state[3],...st['brow:'+p.id]};
        }
      }
      const arms={},legs={},footLift={},footBottom={};
      for(const [side,i]of [['Near',0],['Far',1]]){
        const sign=i?1:-1,ph=phase+i*Math.PI,hostLeg=f.legs?.[i];
        const hostAngle=hostLeg?-Math.atan2(hostLeg[2]-hostLeg[0],Math.max(4,hostLeg[3]-hostLeg[1]))/rad:0;
        const legTune=lerp(tv('walk','leg'),tv('run','leg'),runK),armTune=lerp(tv('walk','arm'),tv('run','arm'),runK);
        // Keep the host's footfall timing; bound the angle to what the existing cutouts can support.
        const gait=follow('gait'+side,clamp(hostAngle,-lerp(14,21,runK),lerp(14,21,runK))*legTune*walkK+clamp(hostAngle,-6,6)*danceK,28,dt);
        const legPose=dragK*(sign*8+Math.sin(f.t*5+i)*7)*tv('drag','leg')+airK*sign*10*tv('jump','leg');
        const leg=gait+follow('legPose'+side,legPose,28,dt);
        let armTarget=Math.sin(f.t*1.1+i)*1.2*tv('idle','arm')*(1-walkK)*(1-danceK)*(1-dragK)*(1-airK);
        armTarget+=danceK*(sign*16+Math.sin(ph)*12)*tv('dance','arm');
        armTarget+=dragK*(sign*18+Math.sin(f.t*8+i)*8)*tv('drag','flail')+airK*sign*23*tv('jump','arm');
        if(!i)armTarget+=76*wave*tv('wave','angle');
        // The stride is added after settling the pose, avoiding a delayed arm swing alongside its own leg.
        const arm=dizzy?0:settle('arm'+side,armTarget,24,dt)-gait*armTune*(1-wave)*(1-dragK)*(1-airK)+(!i?Math.sin(k*Math.PI*10)*7*wave*tv('wave','angle'):0)+sign*flap*12;
        st['arm'+side]={a:arm};
        const hip=model.nodes['leg'+side],part=legParts[side],a=(-55*seat+leg*(1-seat))*rad;
        const corners=[[part.box[0],part.box[1]],[part.box[0]+part.box[2],part.box[1]],[part.box[0],part.box[1]+part.box[3]],[part.box[0]+part.box[2],part.box[1]+part.box[3]]];
        const lowest=Math.max(...corners.map(([px,py])=>Y(hip[1])+Math.sin(a)*(X(px)-X(hip[0]))+Math.cos(a)*(Y(py)-Y(hip[1]))));
        const restBottom=Y(part.box[1]+part.box[3]);
        // Kit feet describe the centre of a round foot, whose standing Y is 241, not the sole at 256.
        const hostFloor=kit.STAND?.[i]?.[3]??241;
        const lift=follow('lift'+side,hostLeg?clamp(hostFloor-hostLeg[3],0,16)*.55*clamp(walkK+danceK):0,28,dt);
        const grounded=clamp(walkK+danceK)*(1-dragK)*(1-airK);
        const ty=lerp((restBottom-lowest)*grounded-lift,256-lowest-(seated?.bodyDrop||0),seat),tx=seat*(i?0:-3),px=X(hip[0]),py=Y(hip[1]);
        // Keep the thigh attached while the lower leg swings and lifts; the boot remains rigid below the blend.
        st['leg'+side]={fn:(u,v,x,y)=>{const w=smooth(py-1,py+12,y),dx=x-px,dy=y-py;
          return[((Math.cos(a)-1)*dx-Math.sin(a)*dy+tx)*w,(Math.sin(a)*dx+(Math.cos(a)-1)*dy+ty)*w];}};
        arms[side]=arm;legs[side]=leg;footLift[side]=lift;footBottom[side]=lowest+ty;
      }
      st.z.part_12=wave>.1?Math.max(...parts.map(p=>p.z))+1:model.parts.find(p=>p.id==='part_12').z;
      const seatedAlpha=seated?smooth(.42,.78,seatProgress):0;
      let seatedGeometry=null;
      if(seated){
        for(const id of standingLegIds)st.alpha[id]=1-seatedAlpha;
        if(seatedAlpha>.001)for(const [id,z]of Object.entries(seated.calibratedLayers||{}))st.z[id]=z;
        for(const spec of seated.parts){
          st.alpha[spec.id]=seatedAlpha;
          // Crossfade into the grounded pose while the retained body settles over the thighs.
          const [bx,by,bw,bh]=spec.box;
          const cx=X(bx+bw/2),cy=Y(by+bh/2),a=(spec.rotation||0)*rad,c=Math.cos(a),sn=Math.sin(a);
          st['seated:'+spec.side]={fn:(u,v,x,y)=>{
            const dx=x-cx,dy=y-cy;
            return[(c-1)*dx-sn*dy,sn*dx+(c-1)*dy+(spec.groundOffset||0)];
          }};
        }
        seatedGeometry={bodyDrop:seat*seated.bodyDrop,floor:seated.floor};
      }
      expressionFace.applyLayout(st,faceState,seatedAlpha);
      rig.render(st);
      const pt=(px,py)=>rig.point('head',st,X(px),Y(py));
      anchors.gaze=pt(676,576);anchors.bubble=pt(626,40);anchors.z=pt(900,190);anchors.tear=pt(795,625);
      for(const key of ['bubble','z','tear'])anchors[key][1]-=f.low||0;
      hits=[[...pt(626,500),56],[...rig.point('upper',st,X(620),Y(1000)),44]];
      const points=parts.filter(p=>(st.alpha[p.id]??1)>.01).flatMap(p=>{const [x,y,w,h]=p.box;return[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(q=>rig.point(p.parent,st,...q));});
      extent=[Math.min(...points.map(p=>p[0]))-2,Math.min(...points.map(p=>p[1]))-2,Math.max(...points.map(p=>p[0]))+2,Math.max(...points.map(p=>p[1]))+2];
      visual={mode,face:f.face,gesture:kind||null,seat,seatedAlpha,seatedGeometry,dizzyBodyFixed,lifeAngle,lifeDip,breath,arms,legs,footLift,footBottom,headAngle:headAngle/rad,upperLean,groupRot:f.groupRot||0,walkK,runK,secondary,calibratedExpression:faceState.layout,expressionEyes:symbols,mouth,eyelids:faceState.eyelids,brows:browVisual,parts:parts.length};
    },dispose(){rig?.dispose();rig=null;mounted=null;}
  };
  native=kit.createBody(host,{figure});
  const standFirst=new Set(['wave','nod','shake','bow','flap','dance','shiver','look','turn','spin']);
  return {...native,step(dt){if(disposed)return;native.step(dt);if(pending&&native.layout().mode==='idle'){const w=pending;pending=null;native.do(w);}},
    do(word){pending=null;if(standFirst.has(word)&&['sit','sleep','dizzy'].includes(native.layout().mode)){pending=word;return native.do('stand');}return native.do(word);},
    walk(...args){pending=null;return native.walk(...args);},pointer(...args){if(args[0]==='down')pending=null;return native.pointer(...args);},
    layout(){const l=native.layout();return pending?{...l,busy:true,moving:true}:l;},visualState(){return visual;},get rigCanvas(){return canvas;},
    dispose(){if(disposed)return;disposed=true;pending=null;native.dispose();textures.clear();}
  };
}



// Integrated original part27/28 face renderer, bundled for a standalone module entry.
/** Native open eyes. Shrinking lashes and their masks share one exact affine transform.
 * The mask follows opaque pixels of the original lash, rather than a fitted quadratic.
 */
async function createExpressionFace({doc,model,load,parts,defs,textures,X,Y,maskCanvases}) {
  const config=model.expressionFace,assets=config.assets,rad=Math.PI/180,S=model.logo_scale;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const originals=Object.fromEntries(model.parts.map(p=>[p.id,{...p,rotation:p.rot||0}]));
  const images=new Map(),specials={},mouths={},eyes={},diagnostics={};let previousRig,transitionFace=null,transitionProgress=0;
  for(const [id,spec]of Object.entries(assets))images.set(id,await load(spec.file));
  const addSprite=(id,spec)=>{
    const node='expression:'+id,[x,y,w,h]=spec.box;defs[node]={kind:'rot',pivot:[X(x+w/2),Y(y+h/2)],parent:'head'};
    parts.push({id:node,tex:node,parent:node,z:spec.z,box:[X(x),Y(y),w*S,h*S],grid:[4,4]});textures.set(node,images.get(id));return{id:node,node,spec};
  };
  for(const [id,spec]of Object.entries(assets)){
    if(id.endsWith('_mouth'))mouths[id.slice(0,-6)]=addSprite(id,spec);else specials[id]=addSprite(id,spec);
  }
  const corners=spec=>{
    const [x,y,w,h]=spec.box,cx=x+w/2,cy=y+h/2,a=spec.rotation*rad,c=Math.cos(a),s=Math.sin(a);
    return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py])=>[cx+c*(px-cx)-s*(py-cy),cy+s*(px-cx)+c*(py-cy)]);
  };
  function place(g,im,spec){const [x,y,w,h]=spec.box;g.save();g.translate(x+w/2,y+h/2);g.rotate(spec.rotation*rad);g.drawImage(im,-w/2,-h/2,w,h);g.restore();}
  function traceLash(data,width,height,x0,x1,R,x,y){
    const contour=[];
    for(let px=x0;px<=x1;px++){
      let best=null,start=-1;
      for(let py=0;py<=height;py++){
        const opaque=py<height&&data[(py*width+px)*4+3]>=192;
        if(opaque&&start<0)start=py;
        if(!opaque&&start>=0){
          const end=py-1;if(!best||end-start>best[1]-best[0])best=[start,end];start=-1;
        }
      }
      // Stay INSIDE the opaque stroke. Cutting below its inner edge creates a skin-colored gap.
      contour.push(best?[x+px/R,y+(best[0]+Math.min(1.2*R,(best[1]-best[0])*.4))/R]:null);
    }
    const valid=contour.map((p,i)=>p?i:-1).filter(i=>i>=0);
    if(valid.length<6)throw Error('Lash contour is not available');
    for(let i=0;i<contour.length;i++)if(!contour[i]){
      const a=valid.filter(j=>j<i).at(-1),b=valid.find(j=>j>i),left=a===undefined?b:a,right=b===undefined?a:b;
      const t=left===right?0:(i-left)/(right-left);
      contour[i]=[x+(x0+i)/R,contour[left][1]*(1-t)+contour[right][1]*t];
    }
    return contour;
  }
  for(const [side,ids]of Object.entries(config.normalEyes)){
    const ball=originals[ids.ball],iris=originals[ids.iris],lid=originals[ids.lid],points=[...corners(ball),...corners(iris),...corners(lid)];
    const x=Math.floor(Math.min(...points.map(p=>p[0]))-24),y=Math.floor(Math.min(...points.map(p=>p[1]))-24),w=Math.ceil(Math.max(...points.map(p=>p[0]))-x+24),h=Math.ceil(Math.max(...points.map(p=>p[1]))-y+24),R=3;
    const cv=doc.createElement('canvas');cv.width=w*R;cv.height=h*R;const g=cv.getContext('2d',{willReadFrequently:true});
    const reset=()=>{g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cv.width,cv.height);g.setTransform(R,0,0,R,-x*R,-y*R);};
    reset();place(g,textures.get(ids.ball),ball);let data=g.getImageData(0,0,cv.width,cv.height).data,x0=cv.width,x1=0,bottomPixel=0;
    const lowerPixels=new Array(cv.width).fill(-1);
    for(let py=0;py<cv.height;py++)for(let px=0;px<cv.width;px++)if(data[(py*cv.width+px)*4+3]>32){x0=Math.min(x0,px);x1=Math.max(x1,px);bottomPixel=Math.max(bottomPixel,py);lowerPixels[px]=py;}
    const left=x+x0/R,right=x+x1/R,cx=(left+right)/2,span=right-left;
    reset();place(g,textures.get(ids.iris),iris);data=g.getImageData(0,0,cv.width,cv.height).data;
    for(let py=0;py<cv.height;py++)for(let px=0;px<cv.width;px++)if(data[(py*cv.width+px)*4+3]>32){bottomPixel=Math.max(bottomPixel,py);lowerPixels[px]=Math.max(lowerPixels[px],py);}
    reset();place(g,textures.get(ids.lid),lid);data=g.getImageData(0,0,cv.width,cv.height).data;
    const contour=traceLash(data,cv.width,cv.height,x0,x1,R,x,y),cy=contour[Math.floor(contour.length/2)][1],bottom=y+bottomPixel/R,travel=Math.max(20,bottom-Math.min(...contour.map(p=>p[1]))+8);
    const masks={};
    for(const id of [ids.ball,ids.iris]){const image=textures.get(id),canvas=maskCanvases?.get(id)||doc.createElement('canvas');canvas.width=image.width;canvas.height=image.height;maskCanvases?.set(id,canvas);masks[id]={image,canvas,g:canvas.getContext('2d'),spec:originals[id]};}
    // A zero warp is exactly the former identity eye parent. Rest rotation stays in rest:<id>.
    defs['eye:'+ids.lid]={kind:'warp',parent:'head',rect:[X(x),Y(y),X(x+w),Y(y+h)]};
    const lowerContour=contour.map((point,i)=>[point[0],Math.max(point[1],lowerPixels[x0+i]>=0?y+(lowerPixels[x0+i]+1)/R:bottom)]);
    eyes[side]={ids,ball,iris,lid,cx,cy,left,right,span,contour,lowerContour,travel,bottom,masks,x,y,w,h,restOpen:1,lastKey:null,mode:null};
  }
  function lidTransform(eye,d,tilt,scale,px,py){
    const c=Math.cos(tilt),s=Math.sin(tilt),dx=(px-eye.cx)*scale,dy=(py-eye.cy)*scale;
    return[eye.cx+c*dx-s*dy,eye.cy+s*dx+c*dy+d];
  }
  function authoredBase(eye,start,progress,px,py){
    if(!start||progress===1)return[px,py];
    const [x,y,w,h]=eye.lid.box,[sx,sy,sw,sh]=start.box,oldAngle=eye.lid.rotation*rad;
    const delta=((eye.lid.rotation-start.rotation+540)%360)-180,angle=(start.rotation+progress*delta)*rad;
    const cx=x+w/2,cy=y+h/2,ux=Math.cos(oldAngle)*(px-cx)+Math.sin(oldAngle)*(py-cy),uy=-Math.sin(oldAngle)*(px-cx)+Math.cos(oldAngle)*(py-cy);
    const width=sw+(w-sw)*progress,height=sh+(h-sh)*progress,mx=sx+sw/2+(cx-sx-sw/2)*progress,my=sy+sh/2+(cy-sy-sh/2)*progress;
    return[mx+Math.cos(angle)*ux*width/w-Math.sin(angle)*uy*height/h,my+Math.sin(angle)*ux*width/w+Math.cos(angle)*uy*height/h];
  }
  function betweenPoses(start,end,progress,px,py){
    if(progress===0)return[px,py];
    const k=progress*progress*(3-2*progress),[x,y,w,h]=start.box,[ex,ey,ew,eh]=end.box;
    const a=(start.rotation||0)*rad,delta=(((end.rotation||0)-(start.rotation||0)+540)%360)-180,angle=((start.rotation||0)+delta*k)*rad;
    const cx=x+w/2,cy=y+h/2,dx=px-cx,dy=py-cy,u=(Math.cos(a)*dx+Math.sin(a)*dy)/w,v=(-Math.sin(a)*dx+Math.cos(a)*dy)/h;
    const width=w+(ew-w)*k,height=h+(eh-h)*k,mx=cx+(ex+ew/2-cx)*k,my=cy+(ey+eh/2-cy)*k;
    return[mx+Math.cos(angle)*u*width-Math.sin(angle)*v*height,my+Math.sin(angle)*u*width+Math.cos(angle)*v*height];
  }
  function maskPart(eye,id,transform,open,dx,dy,rig,ordinaryBlink=0){
    const {image,canvas,g,spec}=eye.masks[id],[x,y,w,h]=spec.box,cx=x+w/2+dx,cy=y+h/2+dy,a=spec.rotation*rad,c=Math.cos(a),s=Math.sin(a);
    g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-over';g.clearRect(0,0,canvas.width,canvas.height);
    if(open<=1e-6){rig.upload(id,canvas);return;}
    g.drawImage(image,0,0);
    // Convert the common master-space lid boundary into this original PNG's own pixel frame.
    const A=image.width/w*c,C=image.width/w*s,B=-image.height/h*s,D=image.height/h*c;
    g.setTransform(A,B,C,D,image.width/2-A*cx-C*cy,image.height/2-B*cx-D*cy);g.globalCompositeOperation='destination-in';
    // Transform the complete aperture using precisely the same operation as the original lash mesh.
    // The lower aperture approaches the actual calibrated lash edge, rather than requiring
    // the lash to descend beyond the original eye bottom. No iris scaling is performed.
    const lowerPhase=clamp((ordinaryBlink-.4)/.6),lowerClose=lowerPhase*lowerPhase*(3-2*lowerPhase);
    const polygon=ordinaryBlink>0?[...eye.contour,...eye.lowerContour.map((p,i)=>[p[0],eye.contour[i][1]+(p[1]-eye.contour[i][1])*(1-lowerClose)]).reverse()]:[...eye.contour,[eye.right,eye.bottom+300],[eye.left,eye.bottom+300]];
    g.beginPath();for(let i=0;i<polygon.length;i++){const q=transform(...polygon[i]);if(i===0)g.moveTo(...q);else g.lineTo(...q);}
    g.closePath();g.fill();g.globalCompositeOperation='source-over';
    rig.upload(id,canvas);
  }
  const shapeNames={up:'happy',down:'sleep',heart:'love',spiral:'dizzy',gt:'drag',lt:'drag'};
  const mouthNames={happy:'happy',wink:'happy',excited:'happy',run:'happy',love:'love',shy:'drag',surprised:'surprised',scared:'drag',worried:'drag',flustered:'drag',dragged:'drag',angry:'drag',sad:'drag',cry:'surprised',confused:'drag',sleep:'sleep',sleepy:'sleep',thinking:'sleep',dizzy:'dizzy',squeeze:'sleep',pout:'surprised'};
  function update({f,face={},blink,look,talk,dt},st,rig){
    if(previousRig!==rig){for(const eye of Object.values(eyes)){eye.lastKey=null;eye.mode=null;}previousRig=rig;}
    const transition=config.authoredLashTransitions?.[f.face];
    if(transitionFace!==f.face){transitionFace=f.face;transitionProgress=0;}
    if(transition){
      transitionProgress=Number.isFinite(f.expressionProgress)?clamp(f.expressionProgress):transitionProgress+(1-transitionProgress)*(1-Math.exp(-12*dt));
      if(transitionProgress>1-1e-6)transitionProgress=1;
    }
    const symbols={near:null,far:null};
    for(const [i,side]of ['near','far'].entries()){
      const eye=eyes[side],e=face.eyes?.[i]||{shape:'ring',rx:16,ry:16};let symbol=shapeNames[e.shape]||null;if(f.mode==='sleep')symbol='sleep';if(f.face==='cry'&&specials['cry_'+(side==='near'?'eyeL':'eyeR')])symbol='cry';symbols[side]=symbol;
      const target=e.shape==='lid'?clamp(e.ry/16):e.shape==='ring'?clamp((e.ry||16)/(e.rx||16)):1;
      if(transition)eye.restOpen=1-(1-target)*transitionProgress;
      else eye.restOpen+=(target-eye.restOpen)*(1-Math.exp(-12*dt));
      if(Math.abs(eye.restOpen-target)<1e-7)eye.restOpen=target;
      const blinkAmount=clamp(blink*(model.tune?.blink??1)),blinkPose=config.blinkCalibration?.[side];
      let open=clamp(eye.restOpen)*(1-blinkAmount);if(open>1-1e-6)open=1;
      // A fully open eye is exactly the authored original, including moods with raised brows.
      // Only apply lid tilt as the eye starts closing; otherwise rotating an open lash can lift it off the sclera.
      const closing=1-open,poseClosing=blinkPose?1-clamp(eye.restOpen):closing,tilt=(face.brows==='angry'?.2:face.brows==='sad'?-.16:0)*(side==='near'?1:-1)*clamp(poseClosing/.12);
      // Preserve 1.4.0 gaze translation; no new expression-driven iris shift or scale is introduced.
      const ix=clamp(look[0]*(model.gaze.k||.2),-model.gaze.x,model.gaze.x)/S,iy=clamp(look[1]*(model.gaze.ky||.5),-model.gaze.y,model.gaze.y)/S;
      for(const id of [eye.ids.ball,eye.ids.iris,eye.ids.lid])st.alpha[id]=symbol||originals[id].hidden?0:1;
      st['eye:'+eye.ids.ball]={};st['eye:'+eye.ids.iris]={tx:ix*S,ty:iy*S};
      const nativeRest=open===1,motion=config.eyelidMotion||{},minScale=clamp(motion.minScale?.[side]??.8,.5,1),scale=1-(1-minScale)*poseClosing**(motion.scalePower??1.3),d=poseClosing===0?0:poseClosing*(eye.travel+Math.abs(tilt)*eye.span/2);
      const neutralBlink=!!blinkPose&&f.face==='neutral',authoredStart=neutralBlink?blinkPose.start:transition?.start?.[side],baseProgress=neutralBlink?0:transitionProgress;
      const transform=(px,py)=>{
        const p=lidTransform(eye,d,tilt,scale,...authoredBase(eye,authoredStart,baseProgress,px,py));
        return blinkPose?betweenPoses(blinkPose.start,blinkPose.end,blinkAmount,...p):p;
      };
      st['eye:'+eye.ids.lid]={fn:(u,v,x,y)=>{
        if(nativeRest&&!authoredStart)return[0,0];
        const p=transform((x-X(eye.cx))/S+eye.cx,(y-Y(eye.cy))/S+eye.cy);
        return[X(p[0])-x,Y(p[1])-y];
      }};
      if(!symbol){
        if(nativeRest){
          if(eye.mode!=='original'){for(const id of [eye.ids.ball,eye.ids.iris])rig.upload(id,eye.masks[id].image);eye.mode='original';eye.lastKey=null;}
        }else{
          const settled=eye.restOpen===target?'settled':'moving';
          const key=[open.toFixed(5),tilt,scale.toFixed(5),authoredStart?baseProgress.toFixed(5):'',blinkAmount.toFixed(5),settled,ix.toFixed(3),iy.toFixed(3)].join(':');
          if(eye.mode!=='masked'||eye.lastKey!==key){maskPart(eye,eye.ids.ball,transform,open,0,0,rig,blinkPose?blinkAmount:0);maskPart(eye,eye.ids.iris,transform,open,ix,iy,rig,blinkPose?blinkAmount:0);eye.mode='masked';eye.lastKey=key;}
        }
      }
      for(const name of ['happy','sleep','love','drag','dizzy','cry']){const item=specials[name+'_'+(side==='near'?'eyeL':'eyeR')];if(!item)continue;st.alpha[item.id]=symbol===name&&!item.spec.hidden?1:0;st[item.node]={a:item.spec.rotation+(name==='dizzy'?Math.sin(f.t*2.6+(side==='near'?0:1.4))*7:0),s:name==='drag'?1+.015*Math.sin(f.t*22+i):1,sy:['happy','sleep','love'].includes(name)?1-.85*clamp(f.eyeClose||0):1};}
      diagnostics[side]={open,symbol,irisOffset:[ix,iy],tilt,travel:eye.travel,lidPart:eye.ids.lid,lidBox:[...eye.lid.box],lidRotation:eye.lid.rotation,lashScale:scale,closingProgress:closing,ordinaryBlink:blinkAmount,calibratedBlink:!!blinkPose,authoredTransition:!!transition?.start?.[side],expressionProgress:transition?.start?.[side]?transitionProgress:null,maskMode:blinkPose?'calibrated-closing-aperture':'transformed-alpha-contour',contourPoints:eye.contour.length,integratedOriginalLid:true,renderMode:symbol?'special-sprite':nativeRest?'original-layers':'masked-original-layers'};
    }
    let mouth=f.face==='cry'&&mouths.cry?'cry':mouthNames[f.face]||null;if(talk>.12)mouth=f.face==='surprised'?'surprised':f.face==='cry'&&mouths.cry?'cry':'happy';if(f.mode==='sleep'&&talk<=.12)mouth='sleep';
    for(const [name,item]of Object.entries(mouths)){st.alpha[item.id]=name===mouth&&!item.spec.hidden?1:0;st[item.node]={a:item.spec.rotation,sy:talk>.12?.45+.55*Math.abs(Math.sin(f.t*17)):1,sx:talk>.12?.9+.1*talk:1};}
    return {eyes:symbols,mouth,eyelids:structuredClone(diagnostics)};
  }
  function reset(){transitionFace=null;transitionProgress=0;previousRig=null;for(const eye of Object.values(eyes)){eye.restOpen=1;eye.lastKey=null;eye.mode=null;}}
  return {update,reset};
}

/** Apply each saved expression in head coordinates, retaining the existing body/physics rig. */
async function createCalibratedExpressionFace(args){
  const {doc,model,parts,defs,textures,X,Y}=args,config=model.expressionFace,S=model.logo_scale;
  const imageCache=new Map(),load=file=>{if(!imageCache.has(file))imageCache.set(file,args.load(file));return imageCache.get(file);};
  const sourceTextures=new Map(textures),maskCanvases=new Map();
  const base=await createExpressionFace({...args,load,maskCanvases});
  const engines=new Map(),layouts=config.expressionLayouts||{},baseParts=new Map(model.parts.map(p=>[p.id,p]));
  const facialIds=new Set(config.calibrationFacialIds||[]),baseAssets=config.assets;
  for(const [key,layout]of Object.entries(layouts)){
    const records=new Map(layout.parts.map(p=>[p.id,p]));
    const poses=new Map([...records].map(([id,p])=>[id,{id,box:[p.x,p.y,p.w,p.h],rotation:p.rot,z:p.z,hidden:!!p.hidden}]));
    const localModel={...model,parts:model.parts.map(p=>poses.has(p.id)?{...p,...poses.get(p.id),rot:poses.get(p.id).rotation}:p),expressionFace:{...config,assets:Object.fromEntries(Object.entries(baseAssets).map(([id,spec])=>[id,poses.has(id)?{...spec,...poses.get(id)}:spec]))}};
    const localTextures=new Map(sourceTextures);
    const engine=await createExpressionFace({doc,model:localModel,load,parts:[],defs:{},textures:localTextures,X,Y,maskCanvases});
    engines.set(key,{engine,poses});
  }
  // Original PNGs retain their individual meshes. A placement warp runs after rest rotation,
  // before the existing eyelid / iris / head nodes. The original PNGs remain the same textures.
  for(const p of model.parts)if(facialIds.has(p.id)){
    const local=defs['rest:'+p.id],parent=local.parent,node='calibration:'+p.id;
    defs[node]={kind:'warp',parent,rect:[-90,-90,330,300]};local.parent=node;
  }
  for(const id of Object.keys(baseAssets)){
    const local=defs['expression:'+id],parent=local.parent,node='calibration:expression:'+id;
    defs[node]={kind:'warp',parent,rect:[-90,-90,330,300]};local.parent=node;
  }
  const rad=Math.PI/180;
  function mapPose(base,target,x,y,baseRotation=base.rot||0,animation={}){
    const [bx,by,bw,bh]=base.box,[tx,ty,tw,th]=target.box,ba=baseRotation*rad,a=(animation.a??target.rotation??0)*rad;
    const dx=x-X(bx+bw/2),dy=y-Y(by+bh/2),u=(Math.cos(ba)*dx+Math.sin(ba)*dy)/(bw*S),v=(-Math.sin(ba)*dx+Math.cos(ba)*dy)/(bh*S);
    const sx=(animation.sx??animation.s??1),sy=(animation.sy??animation.s??1),ux=u*tw*S*sx,vy=v*th*S*sy;
    return[X(tx+tw/2)+Math.cos(a)*ux-Math.sin(a)*vy+(animation.tx||0),Y(ty+th/2)+Math.sin(a)*ux+Math.cos(a)*vy+(animation.ty||0)];
  }
  let selected=null,current=null;
  function update(input,st,rig){
    const next=engines.get(input.f.face)||null;
    if(selected!==input.f.face){(next?.engine||base).reset();selected=input.f.face;}
    current=next;
    const result=(next?.engine||base).update(input,st,rig);
    const poses=next?.poses;
    for(const id of facialIds){
      const p=baseParts.get(id);if(!p)continue;
      const target=poses?.get(id)||{box:p.box,rotation:p.rot||0,z:p.z,hidden:!!p.hidden};
      st['calibration:'+id]={fn:(u,v,x,y)=>{const q=mapPose(p,target,x,y);return[q[0]-x,q[1]-y];}};
    }
    for(const [id,spec]of Object.entries(baseAssets)){
      const node='expression:'+id,target=poses?.get(id)||{...spec,rotation:spec.rotation||0},animation=st[node]||{};
      // Sprite motion is evaluated around its saved current pivot, not the base-pose pivot.
      st[node]={};
      st['calibration:'+node]={fn:(u,v,x,y)=>{const q=mapPose(spec,target,x,y,0,animation);return[q[0]-x,q[1]-y];}};
    }
    return{...result,calibrated:!!next,layout:next?input.f.face:null};
  }
  function applyLayout(st,state,seatedAlpha){
    const poses=current?.poses,offset=seatedAlpha>.001?2:0;
    for(const id of facialIds){
      const original=baseParts.get(id),asset=baseAssets[id];if(!original&&!asset)continue;
      const target=poses?.get(id)||{box:(original||asset).box,z:(original||asset).z,hidden:!!(original||asset).hidden};
      const mesh=asset?'expression:'+id:id;
      st.z[mesh]=target.z+offset;
      if(target.hidden)st.alpha[mesh]=0;
    }
  }
  return{update,applyLayout};
}
