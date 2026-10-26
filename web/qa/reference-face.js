/** Native open eyes. Shrinking lashes and their masks share one exact affine transform.
 * The mask follows opaque pixels of the original lash, rather than a fitted quadratic.
 */
export async function createExpressionFace({doc,model,load,parts,defs,textures,X,Y,maskCanvases}) {
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
