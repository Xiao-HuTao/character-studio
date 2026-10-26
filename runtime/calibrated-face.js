/** Apply each saved expression in head coordinates, retaining the existing body/physics rig. */
export async function createCalibratedExpressionFace(args){
  const {doc,model,parts,defs,textures,X,Y}=args,config=model.expressionFace||{assets:{},normalEyes:{}},S=model.logo_scale;
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
