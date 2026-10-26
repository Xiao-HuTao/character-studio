"""Portable character project format, validation and Coopanion API 2 builds. Standard library only."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import re
import shutil
import struct
import tempfile
import threading
import zipfile
import zlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / 'projects'
LOCK = threading.RLock()
PARENTS = {'body':None,'torso':'body','head':'torso','hair':'head','eyes':'head','iris':'eyes','brow':'head','mouth':'head','armNear':'torso','armFar':'torso','legNear':'body','legFar':'body'}
TUNE = {'idle':{'breath':1,'sway':1,'head':1,'arm':1},'walk':{'arm':.55,'leg':.65},'run':{'arm':.8,'leg':.85},'wave':{'angle':.85,'head':.7},'jump':{'arm':.7,'leg':.7},'drag':{'flail':.7,'leg':.7},'dance':{'arm':1,'head':1},'bow':{'angle':1},'blink':1,'dizzy':{'spin':2.6},'flustered':{'jitter':.2}}
MOTIONS = dict(stand='站起',jump='跳跃',hop='小跳',look='张望',turn='转身',nod='点头',shake='摇头',spin='转圈',sit='坐下',sleep='睡觉',dizzy='眩晕',walk='走路',run='跑步',wave='挥手',bow='鞠躬',shiver='发抖',flap='扑腾',dance='跳舞')
FACES = dict(neutral='平静',happy='开心',wink='眨眼',love='喜欢',shy='害羞',surprised='惊讶',angry='生气',sad='难过',sleepy='犯困',thinking='思考',smug='得意',pout='嘟嘴',worried='担心',determined='认真',flustered='慌张',scared='害怕',excited='期待',cry='大哭',confused='疑惑')

def read(path, default=None):
    return json.loads(Path(path).read_text(encoding='utf-8-sig')) if Path(path).is_file() else copy.deepcopy(default)

def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    with LOCK:
        temporary = path.with_name(path.name + '.tmp')
        temporary.write_text(raw, encoding='utf-8')
        temporary.replace(path)

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', value):
        raise ValueError('工程 ID 只允许小写字母、数字和短横线，最长 64 字符')
    return value

def part_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[\w-]{1,80}', value, flags=re.UNICODE):
        raise ValueError('部件或节点 ID 只允许文字、数字、下划线、短横线')
    return value

def number(value, minimum=-100000, maximum=100000):
    if type(value) not in (int,float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError('数值必须有限且在允许范围内')
    return value

def inside(root, relative):
    root = Path(root).resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ValueError('文件路径必须位于工程目录内')
    return target

def project_path(pid):
    path = inside(PROJECTS, identifier(pid))
    if not (path / 'project.json').is_file():
        raise ValueError('工程不存在：' + pid)
    return path

def png_size(path):
    raw=Path(path).read_bytes();head = raw[:33]
    if len(head)<33 or head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16]!=b'IHDR':
        raise ValueError('不是有效的 PNG：' + str(path))
    w,h = struct.unpack('>II',head[16:24])
    if not (0<w<=16384 and 0<h<=16384):
        raise ValueError('PNG 尺寸必须在 1–16384 像素内')
    offset=8;has_data=False;ended=False
    while offset+12<=len(raw):
        size=int.from_bytes(raw[offset:offset+4],'big');kind=raw[offset+4:offset+8];end=offset+8+size
        if end+4>len(raw) or zlib.crc32(raw[offset+4:end]) & 0xffffffff != int.from_bytes(raw[end:end+4],'big'):
            raise ValueError('PNG 数据截断或 CRC 校验失败：'+str(path))
        has_data |= kind==b'IDAT';offset=end+4
        if kind==b'IEND':ended=True;break
    if not has_data or not ended:raise ValueError('PNG 缺少图像数据或结束标记：'+str(path))
    return w,h

def canvas_size(value):
    if not isinstance(value,list) or len(value)!=2:
        raise ValueError('画布需要 [宽, 高]')
    return [int(number(v,64,8192)) for v in value]

def normalize_nodes(nodes):
    result={}
    for key,value in nodes.items():
        part_id(key)
        result[key]={'pivot':list(value[:2]),'parent':PARENTS.get(key)} if isinstance(value,list) else copy.deepcopy(value)
    return result

def check_rig(rig):
    if not isinstance(rig,dict) or not isinstance(rig.get('nodes'),dict) or not isinstance(rig.get('assign'),dict):
        raise ValueError('绑定需要 nodes 和 assign')
    nodes=rig['nodes']
    for key,node in nodes.items():
        part_id(key)
        if not isinstance(node,dict) or not isinstance(node.get('pivot'),list) or len(node['pivot'])!=2:
            raise ValueError('节点需要两个 pivot 坐标：'+key)
        for value in node['pivot']:number(value)
        if node.get('parent') and node['parent'] not in nodes:raise ValueError('父节点不存在：'+key)
        visited=set();current=key
        while current:
            if current in visited:raise ValueError('父子节点形成循环：'+key)
            visited.add(current);current=nodes[current].get('parent')
    for pid,node in rig['assign'].items():
        part_id(pid)
        if node not in nodes:raise ValueError('部件绑定到不存在的节点：'+pid)

def check_assembly(data):
    if not isinstance(data,dict) or not isinstance(data.get('parts'),list) or len(data['parts'])>500:
        raise ValueError('装配需要 parts 数组，最多 500 个部件')
    used=set()
    for p in data['parts']:
        pid=part_id(p.get('id'))
        if pid in used:raise ValueError('部件 ID 重复：'+pid)
        used.add(pid)
        for key in ('x','y','rot','z'):number(p.get(key,0))
        for key in ('w','h'):number(p.get(key),.01,32768)
    for pid in data.get('removed',[]):part_id(pid)

def validate_tune(value, baseline=TUNE):
    if isinstance(baseline,dict):
        if not isinstance(value,dict) or set(value)!=set(baseline):raise ValueError('参数组或参数名不匹配')
        for key in baseline:validate_tune(value[key],baseline[key])
    else:number(value,0,4)

def new_project(pid,name,canvas):
    identifier(pid);canvas=canvas_size(canvas)
    path=PROJECTS/pid
    if path.exists():raise ValueError('工程 ID 已存在，请换一个')
    path.mkdir(parents=True);(path/'parts').mkdir()
    config={'schema':1,'id':pid,'name':name or pid,'created':datetime.now(timezone.utc).isoformat(),
            'package':{'id':pid,'version':'0.1.0','name':name or pid,'author':'角色制作者','license':'代码 AGPL-3.0；角色素材权利归原权利人'},
            'model':{'canvas':canvas,'center_x':canvas[0]/2,'feet_y':canvas[1], 'logo_scale':256/canvas[1],
                     'accent':'#9d74bb','gaze':{'x':.8,'y':.6,'k':.2,'ky':.5},'tune':copy.deepcopy(TUNE)},
            'defaults':{'tune':copy.deepcopy(TUNE)},'credits':[], 'source':{}}
    write(path/'project.json',config)
    write(path/'parts-manifest.json',{'canvas':canvas,'parts':[]})
    write(path/'assembly-v4.json',{'parts':[],'removed':[]})
    write(path/'rig.json',{'nodes':{},'assign':{}})
    return path

def unique_id(prefix):
    prefix=re.sub('[^a-z0-9-]+','-',prefix.lower()).strip('-')[:50] or 'character'
    pid=prefix;index=2
    while (PROJECTS/pid).exists():pid=f'{prefix}-{index}';index+=1
    return pid

def adapt_official_rig(model):
    """Convert Coopanion's units/pivots/tex mesh format to editable master-pixel parts."""
    units=model['units'];scale=number(units['S'],.00001,100);center=number(units['X0']);feet=number(units['FEET'])
    x=lambda value:round(center+(value-128)/scale,6)
    y=lambda value:round(feet+(value-256)/scale,6)
    rect=lambda b:[b[0],b[1],b[2]-b[0],b[3]-b[1]]
    pivots=model.get('pivots',{})
    at=lambda name,fallback:[x(pivots.get(name,fallback)[0]),y(pivots.get(name,fallback)[1])]
    # Official node names are deformers, not the editor's semantic skeleton nodes.
    semantic={'body':'body','waist':'torso','neck':'head','headMid':'head','headBack':'head','headFront':'head','headFeat':'head',
              'hairSway':'hair','bangsSway':'hair','armNear':'armNear','armFar':'armFar','legBack':'legNear','legFront':'legFar',
              'tailBend':'tail','finNear':'finNear','finFar':'finFar','ahoge':'ahoge','skirt':'skirt','skirtSit':'skirtSit'}
    nodes={key:{'pivot':at(native,[128,128]),'parent':PARENTS[key]} for key,native in
           [('body','body'),('torso','waist'),('head','neck'),('hair','neck'),('eyes','head'),('iris','head'),('brow','head'),('mouth','head'),('armNear','armNear'),('armFar','armFar'),('legNear','legBack'),('legFar','legFront')]}
    for key,parent,pv in [('tail','body','tail'),('finNear','head','finNear'),('finFar','head','finFar'),('ahoge','head','ahoge'),('skirt','body','waist'),('skirtSit','body','waist')]:
        nodes[key]={'pivot':at(pv,[128,128]),'parent':parent}
    outfits=model.get('outfits') or [{}];base_parts=outfits[0].get('parts') or model['parts']
    parts=[]
    for p in base_parts:
        key=part_id(p['id']);b=p['box'];parent=p.get('parent','body')
        if parent not in semantic:raise ValueError('官方网格含尚未支持的变形节点：'+parent)
        parts.append({'id':key,'file':p.get('src') or 'tex/'+part_id(p.get('tex',key))+'.png',
                      'box':[x(b[0]),y(b[1]),round(b[2]/scale,6),round(b[3]/scale,6)],'rot':0,'z':p.get('z',0),
                      'node':'torso' if key=='torso_up' else semantic[parent], 'hidden':parent=='skirtSit' or '_sit' in key})
    feat=model.get('feat',{});eyes=feat.get('eyes',{});sprites=feat.get('sprites',{})
    eye_centers=[[(b[0]+b[2])/2,(b[1]+b[3])/2] for eye in eyes.values() if (b:=eye.get('ball'))]
    if eye_centers:
        eye_pivot=[sum(p[i] for p in eye_centers)/len(eye_centers) for i in (0,1)]
        nodes['eyes']['pivot']=eye_pivot;nodes['iris']['pivot']=eye_pivot.copy()
    if 'neutral_mouth' in sprites:
        b=sprites['neutral_mouth'];nodes['mouth']['pivot']=[(b[0]+b[2])/2,(b[1]+b[3])/2]
    def source_box(key):
        b=sprites[key];box=rect(b)
        if key in ('happy_mouth','drag_mouth','sleep_mouth'):box[1]+={'happy_mouth':9,'drag_mouth':16,'sleep_mouth':4}[key]
        return box
    # Face sprites are already cropped PNGs in master-pixel coordinates, independent of units.DS.
    for native,side in [('eyeL','near'),('eyeR','far')]:
        for layer,z in [('ball',8.9),('iris',8.91),('lash',8.92),('rim',8.93)]:
            box=eyes.get(native,{}).get(layer)
            if box:
                key='eye_'+side+'_'+layer
                parts.append({'id':key,'file':f'feat/{native}_{layer}.png','box':rect(box),'rot':0,'z':z,
                              'node':'iris' if layer=='iris' else 'eyes','side':side})
    if 'neutral_mouth' in sprites:
        parts.append({'id':'mouth_neutral','file':'feat/neutral_mouth.png','box':source_box('neutral_mouth'),'rot':0,'z':8.95,'node':'mouth'})
    width=max([center*2]+[p['box'][0]+p['box'][2] for p in parts]);height=max([feet]+[p['box'][1]+p['box'][3] for p in parts])
    converted={'canvas':canvas_size([math.ceil(width),math.ceil(height)]),'center_x':center,'feet_y':feet,'logo_scale':scale,
               'accent':next((s.get('accent','#4d6bfe') for s in model.get('schemes',[]) if s.get('ready',True)),'#4d6bfe'),
               'gaze':{'x':.8,'y':.6,'k':.2,'ky':.5},'tune':copy.deepcopy(TUNE),'nodes':nodes,'parts':parts}
    mapped={'mouths':{},'mouthBoxes':{},'eyes':{},'eyeBoxes':{},'eyeBoxesByState':{}}
    for target,source in [('smile','happy_mouth'),('o','surprised_mouth'),('wavy','drag_mouth'),('pout','love_mouth')]:
        if source in sprites:mapped['mouths'][target]='feat/'+source+'.png';mapped['mouthBoxes'][target]=source_box(source)
    if 'neutral_mouth' in sprites:mapped['box']=source_box('neutral_mouth')
    for state in ('dizzy','drag'):
        mapped['eyes'][state]={};mapped['eyeBoxesByState'][state]={}
        for native,side in [('eyeL','near'),('eyeR','far')]:
            key=state+'_'+native
            if key in sprites:
                mapped['eyes'][state][side]='feat/'+key+'.png';mapped['eyeBoxesByState'][state][side]=source_box(key)
                mapped['eyeBoxes'].setdefault(side,source_box(key))
    if mapped['mouths'] or any(mapped['eyes'].values()):converted['feat']=mapped
    return converted

def _import_project(source, mode='auto', pid=None, name=None, canvas=None):
    source=Path(source).resolve()
    if not source.is_dir():raise ValueError('源文件夹不存在')
    if mode=='auto':
        mode='project' if (source/'assembly-v4.json').is_file() and (source/'parts').is_dir() else 'pack' if (source/'model.json').is_file() else 'images'
    pid=pid or unique_id(source.name+'-project')
    if mode=='pack':
        model=read(source/'model.json',{})
        if not model.get('parts'):raise ValueError('形象包没有可导入部件')
        manifest=read(source/'figure.json',{})
        official=all('tex' in p and 'file' not in p for p in model['parts']) and isinstance(model.get('units'),dict) and isinstance(model.get('pivots'),dict)
        if official:model=adapt_official_rig(model)
        elif any('file' not in p for p in model['parts']):raise ValueError('不支持的部件格式：需要 file 路径，或官方 units/pivots/tex 网格结构')
        path=new_project(pid,name or manifest.get('name',{}).get('zh') or source.name,model.get('canvas',[1037,1517]))
        config=read(path/'project.json')
        config['model'].update({k:copy.deepcopy(v) for k,v in model.items() if k not in ('parts','nodes','version')})
        merged=copy.deepcopy(TUNE)
        for key,value in model.get('tune',{}).items():
            if key in merged:
                if isinstance(value,dict) and isinstance(merged[key],dict):merged[key].update({k:v for k,v in value.items() if k in merged[key]})
                elif isinstance(value,(int,float)):merged[key]=value
        validate_tune(merged);config['model']['tune']=merged;config['defaults']['tune']=copy.deepcopy(merged)
        config['credits']=manifest.get('credits',[])
        config['package'].update({k:manifest[k] for k in ('id','version','author','license') if k in manifest})
        config['source']={'kind':'pack','path':str(source),'upstream_manifest':manifest}
        if official:
            config['source']['format']='coopanion-official-rig'
            config['source']['conversion_note']='官方网格已转换为可编辑部件。当前使用默认配色和服装；专用网格、换装和弹簧效果未迁移。备用坐姿部件默认隐藏，原包完整副本保留在 source-pack。'
            config['package']['id']=(str(manifest.get('id','figure'))[:57]+'-studio')
            backup=path/'source-pack';backup.mkdir()
            for file in sorted(source.rglob('*')):
                if file.is_file() and (file.suffix.lower() in ('.png','.json','.js','.md','.txt') or file.name.upper() in ('LICENSE','COPYING','NOTICE')):
                    relative=file.relative_to(source);dest=inside(backup,relative);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(inside(source,relative),dest)
        assembly=[];entries=[];assign={}
        for p in model['parts']:
            key=part_id(p['id']);image=inside(source,p['file']);png_size(image)
            shutil.copy2(image,path/'parts'/f'{key}.png')
            x,y,w,h=p['box'];assembly.append({'id':key,'x':x,'y':y,'w':w,'h':h,'rot':p.get('rot',0),'z':p.get('z',0),'hidden':bool(p.get('hidden',False))})
            entries.append({'id':key,'cn':p.get('name',key),'box':p['box'],'z':p.get('z',0),**({'side':p['side']} if 'side' in p else {})})
            assign[key]=p.get('node','torso')
        # Preserve every referenced feature instead of silently dropping mouth/eye differences.
        for rel in feature_files(config['model']):
            image=inside(source,rel);png_size(image);dest=inside(path,rel);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(image,dest)
        thumb=inside(source,manifest.get('thumb') or 'thumbnail.png')
        if thumb.is_file():shutil.copy2(thumb,path/'thumbnail.png')
        write(path/'parts-manifest.json',{'canvas':model.get('canvas',[1037,1517]),'parts':entries})
        write(path/'assembly-v4.json',{'parts':assembly,'removed':[]})
        write(path/'rig.json',{'nodes':normalize_nodes(model.get('nodes',{})),'assign':assign})
        write(path/'project.json',config)
    elif mode=='project':
        man=read(source/'parts-manifest.json',{})
        path=new_project(pid,name or source.name,man.get('canvas',[1037,1517]))
        for image in (source/'parts').glob('*.png'):
            part_id(image.stem);png_size(image);shutil.copy2(image,path/'parts'/image.name)
        for file in ('parts-manifest.json','assembly-v4.json','rig.json'):
            if (source/file).is_file():shutil.copy2(source/file,path/file)
        if (source/'project.json').is_file():
            config=read(source/'project.json');config.update(id=pid,name=name or config['name']);write(path/'project.json',config)
            for rel in feature_files(config['model']):
                dest=inside(path,rel);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(inside(source,rel),dest)
            if (source/'source-pack').is_dir():shutil.copytree(source/'source-pack',path/'source-pack')
        else:
            rig=read(path/'rig.json',{'nodes':{},'assign':{}});rig['nodes']=normalize_nodes(rig['nodes']);write(path/'rig.json',rig)
        for file in ('reference.png','thumbnail.png'):
            if (source/file).is_file():shutil.copy2(source/file,path/file)
    elif mode=='images':
        images=sorted(source.glob('*.png'))
        if not images:raise ValueError('文件夹中没有 PNG')
        path=new_project(pid,name or source.name,canvas or [1037,1517]);w,h=read(path/'project.json')['model']['canvas']
        assembly=[];entries=[];used=set()
        for i,image in enumerate(images):
            iw,ih=png_size(image);key=re.sub(r'[^\w-]','_',image.stem)[:65] or f'part_{i+1}'
            while key in used:key+='_2'
            used.add(key);shutil.copy2(image,path/'parts'/f'{key}.png')
            x=(w-iw)/2;y=(h-ih)/2
            assembly.append({'id':key,'x':x,'y':y,'w':iw,'h':ih,'rot':0,'z':i+1})
            entries.append({'id':key,'cn':image.stem,'box':[x,y,iw,ih],'z':i+1})
        write(path/'assembly-v4.json',{'parts':assembly,'removed':[]});write(path/'parts-manifest.json',{'canvas':[w,h],'parts':entries})
    else:raise ValueError('不支持的导入方式')
    return path

def import_project(source, mode='auto', pid=None, name=None, canvas=None):
    """Stage copies so failed imports never leave an incomplete named project."""
    source=Path(source).resolve()
    pid=identifier(pid or unique_id(source.name+'-project'))
    target=PROJECTS/pid
    if target.exists():raise ValueError('工程 ID 已存在，请换一个')
    temporary_id='import-'+uuid.uuid4().hex
    temporary=PROJECTS/temporary_id
    try:
        _import_project(source,mode,temporary_id,name,canvas)
        config=read(temporary/'project.json');config['id']=pid
        if config['package']['id']==temporary_id:config['package']['id']=pid
        write(temporary/'project.json',config)
        if not temporary.resolve().is_relative_to(PROJECTS.resolve()) or not target.resolve().is_relative_to(PROJECTS.resolve()):raise ValueError('导入目标超出工程目录')
        temporary.rename(target)
        return target
    except Exception:
        if temporary.is_dir() and temporary.resolve().is_relative_to(PROJECTS.resolve()):shutil.rmtree(temporary)
        raise

def feature_files(model):
    feat=model.get('feat',{}) or {}
    files=list((feat.get('mouths',{}) or {}).values())
    for sides in (feat.get('eyes',{}) or {}).values():files.extend(sides.values())
    return sorted(set(files))

def state(path):
    return {'project':read(path/'project.json'), 'manifest':read(path/'parts-manifest.json',{}),
            'assembly':read(path/'assembly-v4.json',{'parts':[],'removed':[]}), 'rig':read(path/'rig.json',{'nodes':{},'assign':{}})}

def rename_part(path, old, new):
    """Rename a PNG and all live project references; restore the original state on write failure."""
    old=part_id(old);new=part_id(new);path=Path(path).resolve()
    with LOCK:
        data=state(path)
        entries=data['assembly']['parts']+data['manifest'].get('parts',[])
        if not any(p['id']==old for p in entries):raise ValueError('部件不存在：'+old)
        source=inside(path,'parts/'+old+'.png');target=inside(path,'parts/'+new+'.png')
        if not source.is_file():raise ValueError('部件贴图不存在：'+old)
        if old==new:return {'ok':True,'old':old,'new':new}
        reserved={p['id'] for p in entries}|set(data['assembly'].get('removed',[]))|set(data['rig']['assign'])
        if any(key!=old and key.casefold()==new.casefold() for key in reserved):raise ValueError('名称已被其他部件使用：'+new)
        if target.exists() and not target.samefile(source):raise ValueError('同名 PNG 已存在：'+new)
        png_size(source)
        for p in entries:
            if p['id']==old:
                p['id']=new
                if p.get('cn')==old:p['cn']=new
        data['assembly']['removed']=[new if key==old else key for key in data['assembly'].get('removed',[])]
        if old in data['rig']['assign']:data['rig']['assign'][new]=data['rig']['assign'].pop(old)
        def references(value):
            if isinstance(value,dict):return {key:references(item) for key,item in value.items()}
            if isinstance(value,list):return [references(item) for item in value]
            if isinstance(value,str):
                relative=value.replace('\\','/')
                while relative.startswith('./'):relative=relative[2:]
                if relative.casefold()==('parts/'+old+'.png').casefold():return 'parts/'+new+'.png'
            return value
        data['project']['model']=references(data['project']['model'])
        files={'parts-manifest.json':data['manifest'],'assembly-v4.json':data['assembly'],'rig.json':data['rig'],'project.json':data['project']}
        original={name:(path/name).read_bytes() if (path/name).is_file() else None for name in files}
        temporary=inside(path,'parts/.rename-'+uuid.uuid4().hex+'.png');moved=False
        try:
            source.rename(temporary);temporary.rename(target);moved=True
            for name,value in files.items():write(path/name,value)
        except Exception:
            if moved:target.rename(temporary)
            if temporary.exists():temporary.rename(source)
            for name,raw in original.items():
                output=path/name
                if raw is None:output.unlink(missing_ok=True)
                else:
                    staging=output.with_name(output.name+'.rollback');staging.write_bytes(raw);staging.replace(output)
            raise
        return {'ok':True,'old':old,'new':new}

def deleted_projects():
    trash=PROJECTS.parent/'project-trash'
    result=[]
    if trash.is_dir():
        for entry in trash.iterdir():
            if re.fullmatch(r'[a-f0-9]{32}',entry.name) and (entry/'project/project.json').is_file():
                receipt=read(entry/'receipt.json',{})
                if receipt:result.append(receipt)
    return sorted(result,key=lambda item:item['deleted_at'],reverse=True)

def delete_project(pid):
    with LOCK:
        source=project_path(pid);config=read(source/'project.json');token=uuid.uuid4().hex
        trash=(PROJECTS.parent/'project-trash').resolve();entry=inside(trash,token);target=inside(entry,'project')
        if not source.resolve().is_relative_to(PROJECTS.resolve()) or not target.resolve().is_relative_to(trash):raise ValueError('回收目标超出工程目录')
        entry.mkdir(parents=True)
        receipt={'token':token,'id':pid,'name':config['name'],'deleted_at':datetime.now(timezone.utc).isoformat()}
        write(entry/'receipt.json',receipt)
        source.rename(target)
        return {'ok':True,**receipt}

def restore_project(token):
    if not isinstance(token,str) or not re.fullmatch(r'[a-f0-9]{32}',token):raise ValueError('无效的回收记录')
    with LOCK:
        trash=(PROJECTS.parent/'project-trash').resolve();entry=inside(trash,token);source=inside(entry,'project')
        receipt=read(entry/'receipt.json',{});pid=identifier(receipt.get('id'))
        target=inside(PROJECTS,pid)
        if target.exists():raise ValueError('同 ID 工程已存在，不能覆盖：'+pid)
        if not (source/'project.json').is_file():raise ValueError('回收工程不存在')
        if not source.resolve().is_relative_to(trash) or not target.resolve().is_relative_to(PROJECTS.resolve()):raise ValueError('恢复目标超出工程目录')
        source.rename(target)
        return {'ok':True,'id':pid,'name':receipt['name']}

def validate(path):
    data=state(path);config=data['project'];errors=[];warnings=[]
    notice=config.get('source',{}).get('conversion_note','')
    if notice:warnings.append(notice)
    try:
        canvas_size(config['model']['canvas']);check_assembly(data['assembly']);check_rig(data['rig']);validate_tune(config['model']['tune'])
        package=config['package'];identifier(package['id'])
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?',package['version']):raise ValueError('版本号需要类似 0.1.0 或 0.1.0-preview')
        for key in ('center_x','feet_y','logo_scale'):number(config['model'][key], .00001 if key=='logo_scale' else -100000)
    except (ValueError,KeyError,TypeError) as error:errors.append(str(error))
    visible=[p for p in data['assembly']['parts'] if not p.get('hidden') and p['id'] not in data['assembly'].get('removed',[])]
    initial={p['id']:p.get('box') for p in data['manifest'].get('parts',[])}
    if not visible:errors.append('没有可见部件，请先导入并组装贴图')
    for p in visible:
        try:
            iw,ih=png_size(inside(path,'parts/'+part_id(p['id'])+'.png'))
            if p['id'] not in data['rig']['assign']:errors.append('部件尚未绑定：'+p['id'])
            box=initial.get(p['id']);ratio=box[2]/box[3] if box and box[3]>0 else iw/ih
            if abs((p['w']/p['h'])/ratio-1)>.04:warnings.append('部件宽高比相对初始装配已改变：'+p['id'])
        except (OSError,ValueError) as error:errors.append('贴图缺失或损坏：'+p['id']+' · '+str(error))
    for node in ('body','torso','head','armNear','armFar','legNear','legFar'):
        if node not in data['rig']['nodes']:errors.append('缺少基础动作节点：'+node)
    if not errors:
        used=set()
        for p in visible:
            node=data['rig']['assign'].get(p['id'])
            while node:
                used.add(node);node=data['rig']['nodes'][node].get('parent')
        for node in ('armNear','armFar','legNear','legFar','eyes','mouth'):
            if node not in used:warnings.append('没有部件绑定到 '+node+' 或其子节点，相应部位不会独立运动')
    for rel in feature_files(config['model']):
        try:png_size(inside(path,rel))
        except (OSError,ValueError):errors.append('表情素材缺失：'+rel)
    if not config['model'].get('feat'):warnings.append('尚无嘴型/特殊眼差分；内置表情仅使用已有眼、眉、嘴部件变换')
    warnings.append('坐下/睡觉使用通用骨架姿势，正式坐姿建议制作专用素材；左右朝向为整体镜像')
    return {'ok':not errors,'errors':list(dict.fromkeys(errors)),'warnings':list(dict.fromkeys(warnings)), 'visible_parts':len(visible),'nodes':len(data['rig']['nodes']),'engine':'通用部件骨架 / Coopanion API 2','import_notice':notice}

def fingerprint(path):
    digest=hashlib.sha256()
    for file in sorted(path.rglob('*')):
        if file.is_file() and file.relative_to(path).parts[0] not in ('trash','.history') and (file.suffix.lower() in ('.json','.png')):
            digest.update(file.relative_to(path).as_posix().encode());digest.update(file.read_bytes())
    digest.update((ROOT/'runtime/figure.js').read_bytes())
    digest.update(Path(__file__).read_bytes())
    digest.update((ROOT/'vendor/kit/body.js').read_bytes())
    return digest.hexdigest()

def build(path, output):
    report=validate(path)
    if not report['ok']:raise ValueError('工程检查未通过：\n'+'\n'.join(report['errors']))
    data=state(path);config=data['project'];model=copy.deepcopy(config['model']);package=config['package'];output=Path(output)
    metadata={p['id']:p for p in data['manifest'].get('parts',[])}
    output.mkdir(parents=True,exist_ok=False);(output/'tex').mkdir()
    model['nodes']=data['rig']['nodes'];model['version']=package['version'];model['parts']=[]
    for p in sorted(data['assembly']['parts'],key=lambda p:p.get('z',0)):
        if p.get('hidden') or p['id'] in data['assembly'].get('removed',[]):continue
        key=p['id'];shutil.copy2(path/'parts'/f'{key}.png',output/'tex'/f'{key}.png')
        model['parts'].append({'id':key,'file':f'tex/{key}.png','box':[p[k] for k in ('x','y','w','h')], 'rot':p.get('rot',0),'z':p.get('z',0),'node':data['rig']['assign'][key],**({'side':metadata[key]['side']} if metadata.get(key,{}).get('side') else {})})
    for rel in feature_files(model):
        dest=inside(output,rel);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(inside(path,rel),dest)
    vocab=[{'id':key,'kind':kind,'names':{'zh':[label]},'about':{'zh':label},'seconds':4} for kind,items in [('expression',FACES),('motion',MOTIONS)] for key,label in items.items()]
    manifest={'manifest':2,'api':2,**package,'name':{'zh':package['name'],'en':package['name']},'entry':'figure.js','export':'createRigBody','model':'model.json','axes':[],'presets':[],'vocab':vocab,'sounds':{},'can':{'walk':True},'moves':[],'needs':[],
              'about':{'zh':'由角色工程台组装、绑定和预览的部件骨架形象包'},'credits':config.get('credits',[])+[{'role':'宿主身体与交互','name':'Pal-AI-Lab / Coopanion','url':'https://github.com/Pal-AI-Lab/Coopanion'}]}
    if (path/'thumbnail.png').is_file():shutil.copy2(path/'thumbnail.png',output/'thumbnail.png');manifest['thumb']='thumbnail.png'
    write(output/'model.json',model);write(output/'figure.json',manifest)
    shutil.copy2(ROOT/'runtime/figure.js',output/'figure.js');shutil.copy2(ROOT/'vendor/kit/LICENSE',output/'LICENSE')
    write(output/'SOURCE.json',{'project':config['id'],'fingerprint':fingerprint(path),'source':config.get('source',{}),'engine':'tools/runtime/figure.js','upstream':'https://github.com/Pal-AI-Lab/Coopanion'})
    write(output/'CHECKS.json',report)
    (output/'README.md').write_text(f"# {package['name']} {package['version']}\n\nCoopanion API 2 形象包。ZIP 根目录含 figure.json，可在装扮中导入。\n\n此包使用通用部件骨架；预览与导出使用相同文件。坐姿、接缝、镜像和原生宿主仍需视觉复核。\n\n作者：{package['author']}\n许可：{package.get('license','')}\n",encoding='utf-8')
    return report

def preview(path):
    key=fingerprint(path)[:20];relative=f'builds/preview/{path.name}/{key}';output=ROOT/relative
    with LOCK:
        if not (output/'figure.json').is_file():
            output.parent.mkdir(parents=True,exist_ok=True)
            temporary=Path(tempfile.mkdtemp(prefix='build-',dir=output.parent));temporary.rmdir()
            try:build(path,temporary);temporary.replace(output)
            except Exception:
                if temporary.is_dir():shutil.rmtree(temporary)
                raise
    return {'base':'/'+relative+'/', 'fingerprint':key,'report':validate(path)}

def archive(directory, target):
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for file in sorted(directory.rglob('*')):
            if file.is_file():z.write(file,file.relative_to(directory).as_posix())

def export(path):
    source=preview(path);config=read(path/'project.json');package=config['package'];fp=source['fingerprint']
    stem=f"{package['id']}-{package['version']}-{fp[:8]}";out=ROOT/'exports'/stem
    with LOCK:
        if not out.exists():shutil.copytree(ROOT/source['base'].strip('/'),out)
        target=ROOT/'exports'/(stem+'.zip');archive(out,target)
    return {'ok':True,'dir':str(out),'zip':str(target),'url':'/exports/'+target.name,'fingerprint':fp,'report':source['report']}

import sys
import studio_v2
studio_v2.install(sys.modules[__name__])

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['check','build']);parser.add_argument('project');args=parser.parse_args()
    path=project_path(args.project)
    result=validate(path) if args.command=='check' else export(path)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if not result.get('ok'):raise SystemExit(1)
