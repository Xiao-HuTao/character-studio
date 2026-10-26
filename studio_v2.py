"""Portable v2 features and one shared build contract. Python standard library only."""
import copy, hashlib, json, math, shutil, zipfile
from pathlib import Path

FEATURES=('expressionFace','browMotion','physics','seatedLegs','motionGeometry','motionOptions')

def install(core):
    old={k:getattr(core,k) for k in ('new_project','_import_project','validate','build','fingerprint','rename_part')}
    root=core.ROOT
    def validate_tune(value, baseline=None):
        if isinstance(value,dict):
            if baseline is not None and (not isinstance(baseline,dict) or set(value)!=set(baseline)):raise ValueError('参数组或参数名不匹配')
            for k,v in value.items():validate_tune(v,baseline[k] if baseline is not None else None)
        else:core.number(value,0,4)
    core.validate_tune=validate_tune

    def files(value):
        result=set()
        def scan(v):
            if isinstance(v,dict):
                for child in v.values():scan(child)
            elif isinstance(v,list):
                for child in v:scan(child)
            elif isinstance(v,str) and v.lower().endswith('.png'):result.add(v)
        for k in ('feat','expressionFace','seatedLegs'):scan(value.get(k,{}))
        return sorted(result)
    core.feature_files=files

    def new_project(*args,**kwargs):
        p=old['new_project'](*args,**kwargs);c=core.read(p/'project.json');c['schema']=2
        c['engine']='generic';core.write(p/'project.json',c);return p
    core.new_project=new_project

    def roles(face):
        result={}
        for id in face.get('assets',{}):
            if id.endswith('_mouth'):result[id]={'kind':'mouth','state':id[:-6]}
            elif id.endswith(('_eyeL','_eyeR')):result[id]={'kind':'eye','state':id[:-5],'side':'near' if id.endswith('_eyeL') else 'far'}
        return result

    def import_low(source,mode='auto',pid=None,name=None,canvas=None):
        source=Path(source).resolve()
        if mode=='auto':mode='project' if (source/'assembly-v4.json').is_file() else 'pack' if (source/'model.json').is_file() else 'images'
        if mode=='project' and (source/'project.json').is_file():
            dest=core.PROJECTS/pid
            shutil.copytree(source,dest,ignore=shutil.ignore_patterns('__pycache__','.history','trash'))
            c=core.read(dest/'project.json');c.update(id=pid,name=name or c['name'],schema=2);core.write(dest/'project.json',c)
            return dest
        m=core.read(source/'model.json',{}) if mode=='pack' else {}
        if m.get('expressionFace'):
            manifest=core.read(source/'figure.json');p=new_project(pid,name or manifest.get('name',{}).get('zh') or source.name,m['canvas'])
            c=core.read(p/'project.json');c['model']={k:copy.deepcopy(v) for k,v in m.items() if k not in ('parts','nodes','version')};c['defaults']={'tune':copy.deepcopy(m['tune'])};c['engine']='layered'
            c['package'].update({k:manifest[k] for k in ('id','version','author','license') if isinstance(manifest.get(k),str)})
            c['credits']=manifest.get('credits',[]);c['source']={'kind':'pack','upstream_manifest':manifest}
            a={'parts':[],'removed':[],'expressionLayoutSchema':1,'expressionLayouts':copy.deepcopy(m['expressionFace'].get('expressionLayouts',{})),'authoredLashTransitions':copy.deepcopy(m['expressionFace'].get('authoredLashTransitions',{})),'blinkCalibration':copy.deepcopy(m['expressionFace'].get('blinkCalibration',{}))}
            entries=[];assign={};face=c['model']['expressionFace'];face.setdefault('spriteRoles',roles(face));face['calibration']='art-source/saved-expression-assembly.json'
            for spec in [*m['parts'],*[dict(v,id=k,node='head') for k,v in face.get('assets',{}).items()],*[dict(v,node='body',hidden=True) for v in m.get('seatedLegs',{}).get('parts',[])]]:
                id=core.part_id(spec['id']);file=core.inside(source,spec['file']);core.png_size(file);shutil.copy2(file,p/'parts'/f'{id}.png')
                row=dict(zip(('x','y','w','h'),spec['box']),id=id,z=spec.get('z',0),rot=spec.get('rot',spec.get('rotation',0)),hidden=bool(spec.get('hidden',False)),pinned=False)
                a['parts'].append(row);entries.append({'id':id,'cn':id,'box':spec['box'],'z':row['z']});assign[id]=spec.get('node','head')
                if id in face.get('assets',{}):face['assets'][id]['file']=f'parts/{id}.png'
                for part in c['model'].get('seatedLegs',{}).get('parts',[]):
                    if part['id']==id:part['file']=f'parts/{id}.png'
            for rel in files(c['model']):
                if (p/rel).is_file():continue
                target=core.inside(p,rel);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(core.inside(source,rel),target)
            core.write(p/'assembly-v4.json',a);core.write(p/'parts-manifest.json',{'canvas':m['canvas'],'parts':entries})
            core.write(p/'rig.json',{'nodes':core.normalize_nodes(m['nodes']),'assign':assign});core.write(p/'project.json',c)
            for file in ('thumbnail.png','preview.png'):
                if (source/file).is_file():shutil.copy2(source/file,p/file)
        else:p=old['_import_project'](source,mode,pid,name,canvas)
        if mode=='pack':
            backup=p/'source-pack'
            if backup.exists():
                # Existing official converter already made a copy; fill any remaining original files.
                shutil.copytree(source,backup,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','.git'))
            else:shutil.copytree(source,backup,ignore=shutil.ignore_patterns('__pycache__','.git'))
            c=core.read(p/'project.json');c.update(schema=2);c['source']['nativePack']='source-pack'
            if not c['package']['id'].endswith('-studio'):c['package']['id']=c['package']['id'][:57]+'-studio'
            core.write(p/'project.json',c)
        return p
    core._import_project=import_low

    def effective(path):
        d=core.state(path);m=copy.deepcopy(d['project']['model']);a=d['assembly'];rig=d['rig'];rows={p['id']:p for p in a['parts']}
        face=m.get('expressionFace');assets=face.get('assets',{}) if face else {}
        seated=m.get('seatedLegs',{});seat_ids={p['id'] for p in seated.get('parts',[])}
        excluded=set(assets)|seat_ids|set(a.get('removed',[]));m['parts']=[]
        facial=set(face.get('calibrationFacialIds',[])) if face else set()
        for p in a['parts']:
            if p['id'] in excluded or p.get('hidden') and p['id'] not in facial:continue
            m['parts'].append({'id':p['id'],'file':f"parts/{p['id']}.png",'box':[p[k] for k in ('x','y','w','h')],'rot':p.get('rot',0),'z':p.get('z',0),'node':rig['assign'].get(p['id'],'head'),**({'hidden':True} if p.get('hidden') else {})})
        m['nodes']=copy.deepcopy(rig['nodes']);m['version']=d['project']['package']['version']
        if face:
            eye_nodes={id:('iris' if kind=='iris' else 'eyes') for eye in face.get('normalEyes',{}).values() for kind,id in eye.items()}
            brow_ids=set(m.get('browMotion',{}).get('ids',{}).values())
            for p in m['parts']:
                if p['id'] in eye_nodes:p['node']=eye_nodes[p['id']]
                if p['id'] in brow_ids:p['node']='brow'
                if p['id']==face.get('originalMouth'):p['node']='mouth'
            for id,spec in assets.items():
                p=rows.get(id)
                if not p:raise ValueError('表情贴图部件缺失：'+id)
                # A saved expression layout is independent of the base placement.
                spec.update(box=[p[k] for k in ('x','y','w','h')],rotation=p.get('rot',0),z=p.get('z',0))
            for key in ('expressionLayouts','authoredLashTransitions','blinkCalibration'):
                if key in a and key!='blinkCalibration':face[key]=copy.deepcopy(a[key])
            # A new eye starts with two identical explicit poses until the user adjusts it.
            # Endpoint saves are partial: changing one side/phase never replaces its siblings.
            source_blink=face.get('blinkCalibration',{});saved_blink=a.get('blinkCalibration',{})
            blink={'schema':1,'interpolation':'smoothstep'}
            for side,eye in face.get('normalEyes',{}).items():
                p=rows.get(eye.get('lid'))
                if not p:continue
                neutral={'box':[p[k] for k in ('x','y','w','h')],'rotation':p.get('rot',0),'z':p.get('z',0)}
                blink[side]={phase:copy.deepcopy(saved_blink.get(side,{}).get(phase,source_blink.get(side,{}).get(phase,neutral))) for phase in ('start','end')}
            face['blinkCalibration']=blink
            face.setdefault('spriteRoles',roles(face));face.setdefault('assets',{});face.setdefault('normalEyes',{})
            face.setdefault('calibrationFacialIds',[]);face['calibration']='art-source/saved-expression-assembly.json'
        for spec in seated.get('parts',[]):
            if spec['id'] in rows:
                p=rows[spec['id']];spec.update(box=[p[k] for k in ('x','y','w','h')],rotation=p.get('rot',0),z=p.get('z',0))
                if spec['id'] in seated.get('calibratedLayers',{}):seated['calibratedLayers'][spec['id']]=p.get('z',0)
        return m
    core.effective_model=effective

    def validate(path):
        d=core.state(path);c=d['project'];m=c['model']
        # Base validation handles ordinary parts, binding graph, PNGs and tune values.
        report=old['validate'](path)
        try:
            built=effective(path);ids={p['id'] for p in built['parts']};face=built.get('expressionFace',{});assets=face.get('assets',{});allids=ids|set(assets)
            for key,layout in face.get('expressionLayouts',{}).items():
                core.check_assembly(layout)
                for p in layout['parts']:
                    if p['id'] not in allids:raise ValueError('表情引用不存在的部件：'+key+' / '+p['id'])
            used=[]
            for side,eye in face.get('normalEyes',{}).items():
                if side not in ('near','far') or set(eye)!= {'ball','iris','lid'}:raise ValueError('眼睛需分别绑定眼白、虹膜、眼睑')
                for id in eye.values():
                    if id not in ids:raise ValueError('眼睛绑定部件不存在：'+id)
                    used.append(id)
            if len(used)!=len(set(used)):raise ValueError('左右眼角色不能重复使用同一部件')
            for side,ends in face.get('blinkCalibration',{}).items():
                if side in ('schema','interpolation'):continue
                if side not in face.get('normalEyes',{}):raise ValueError('请先绑定该侧眼睛：'+side)
                for phase in ('start','end'):
                    p=ends[phase];box=p['box']
                    if len(box)!=4:raise ValueError('眨眼端点需要四个坐标')
                    for n in box:core.number(n)
                    core.number(box[2],.01,32768);core.number(box[3],.01,32768);core.number(p.get('rotation',0));core.number(p.get('z',0))
            for id,r in face.get('spriteRoles',{}).items():
                if id not in assets or r.get('kind') not in ('mouth','eye') or (r['kind']=='eye' and r.get('side') not in ('near','far')):raise ValueError('表情贴图角色配置错误：'+id)
            for id,p in built.get('physics',{}).get('parts',{}).items():
                if id not in ids or p.get('group') not in ('hair','bangs','ribbon','skirt'):raise ValueError('物理部件或分组无效：'+id)
                core.number(p['rootY']);core.number(p['tipY']);core.number(p.get('gain',1),0,4)
                if p['tipY']<=p['rootY']:raise ValueError('物理末端须低于根部：'+id)
            if c.get('engine')=='layered':
                for side in ('Near','Far'):
                    if not any(p['node']=='leg'+side for p in built['parts']):raise ValueError('高级动作需要绑定近腿和远腿')
            for p in built.get('seatedLegs',{}).get('parts',[]):
                if p['side'] not in ('Near','Far'):raise ValueError('坐姿需指定近侧或远侧')
                if len(p.get('source',[]))!=4 or min(p['source'][2:])<=0:raise ValueError('坐姿贴图需要有效裁切区域')
            seated=built.get('seatedLegs') or {}
            if any(id not in ids for id in seated.get('replaceIds',[])):raise ValueError('坐姿替换范围包含不存在的原部件')
            fade=seated.get('fadeRange',[.42,.78])
            if len(fade)!=2 or not 0<=fade[0]<fade[1]<=1:raise ValueError('坐姿渐变需要 0 ≤ 开始 < 完成 ≤ 1')
            # Recursive finite-number check applies to every advanced configuration field.
            def finite(v):
                if isinstance(v,dict):
                    for x in v.values():finite(x)
                elif isinstance(v,list):
                    for x in v:finite(x)
                elif type(v) in (int,float) and not math.isfinite(v):raise ValueError('高级配置含无效数值')
            for k in FEATURES:finite(built.get(k))
        except (ValueError,KeyError,TypeError,OSError) as e:report['errors'].append(str(e))
        report['errors']=list(dict.fromkeys(report['errors']));report['ok']=not report['errors'];report['engine']='高级部件运行时' if c.get('engine')=='layered' else '通用部件骨架'
        if m.get('seatedLegs'):report['warnings']=[s for s in report['warnings'] if '通用骨架姿势' not in s]
        return report
    core.validate=validate

    def runtime():
        generic=(root/'runtime/generic.js').read_text(encoding='utf-8').replace('export async function createRigBody','async function createGenericBody')
        layered=(root/'runtime/layered.js').read_text(encoding='utf-8').replace('export async function createRigBody','async function createLayeredBody')
        face=(root/'runtime/face.js').read_text(encoding='utf-8').replace('export async function createExpressionFace','async function createExpressionFace')
        adapter=(root/'runtime/calibrated-face.js').read_text(encoding='utf-8').replace('export async function createCalibratedExpressionFace','async function createCalibratedExpressionFace')
        return '\n'.join([generic,layered,face,adapter,"export async function createRigBody(base,opts){return (opts.model.studioEngine==='layered'?createLayeredBody:createGenericBody)(base,opts);}"])
    core.bundle_runtime=runtime

    def export_authorship(path,output):
        config=core.read(path/'project.json');output=Path(output)
        version=core.read(root/'VERSION.json',{})
        source=core.read(output/'SOURCE.json',{})
        source['tool']={'name':'角色工程台','version':version.get('version','2.0.0'),'author':version.get('author',''),'authorUrl':version.get('author_url','')}
        if config.get('authorship'):
            core.write(output/'AUTHORSHIP.json',config['authorship'])
            source['authorship']='AUTHORSHIP.json'
        core.write(output/'SOURCE.json',source)

    def build(path,output):
        d=core.state(path);c=d['project']
        if c.get('engine')!='layered':
            report=old['build'](path,output)
            # Include the same portable entry in both engines; feature config cannot go stale.
            Path(output,'figure.js').write_text(runtime(),encoding='utf-8')
            export_authorship(path,output)
            return report
        report=validate(path)
        if not report['ok']:raise ValueError('工程检查未通过：'+'; '.join(report['errors']))
        output=Path(output);output.mkdir(parents=True,exist_ok=False)
        model=effective(path);model['studioEngine']='layered'
        refs=set(files(model))|{p['file'] for p in model['parts']}
        for rel in refs:
            src=core.inside(path,rel);dest=core.inside(output,rel);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
        art=output/'art-source';art.mkdir()
        core.write(art/'saved-expression-assembly.json',d['assembly']);core.write(art/'saved-expression-project.json',c)
        if model.get('expressionFace'):model['expressionFace']['sourceSha256']=hashlib.sha256((art/'saved-expression-assembly.json').read_bytes()).hexdigest()
        manifest=copy.deepcopy(c.get('source',{}).get('upstream_manifest',{}))
        package=c['package'];manifest.update({**package,'manifest':2,'api':2,'name':{'zh':package['name'],'en':package['name']},'entry':'figure.js','export':'createRigBody','model':'model.json'})
        manifest.setdefault('vocab',[{'id':key,'kind':kind,'names':{'zh':[label]},'seconds':4} for kind,items in [('expression',core.FACES),('motion',core.MOTIONS)] for key,label in items.items()])
        for key,value in {'axes':[],'presets':[],'sounds':{},'can':{'walk':True},'moves':[],'needs':[]}.items():manifest.setdefault(key,value)
        manifest['credits']=c.get('credits',[])
        if c.get('description'):manifest['about']={'zh':c['description']}
        if (path/'thumbnail.png').is_file():shutil.copy2(path/'thumbnail.png',output/'thumbnail.png');manifest['thumb']='thumbnail.png'
        else:manifest.pop('thumb',None)
        core.write(output/'model.json',model);core.write(output/'figure.json',manifest)
        (output/'figure.js').write_text(runtime(),encoding='utf-8');shutil.copy2(root/'vendor/kit/LICENSE',output/'LICENSE')
        core.write(output/'CHECKS.json',report);core.write(output/'SOURCE.json',{'project':c['id'],'fingerprint':fingerprint(path),'engine':'character-studio-2.0.0-layered','previewAndExportIdentical':True})
        (output/'README.md').write_text(f"# {package['name']} {package['version']}\n\nCoopanion API 2；导入 ZIP 即可。由角色工程台 2.0.0 的同一构建器预览及导出。\n",encoding='utf-8')
        export_authorship(path,output)
        return report
    core.build=build

    def fingerprint(path):
        digest=hashlib.sha256()
        for base in (Path(path),root/'runtime'):
            for p in sorted(base.rglob('*')):
                if p.is_file() and not any(x in p.parts for x in ('trash','.history','source-pack','__pycache__')):
                    digest.update(p.relative_to(base).as_posix().encode());digest.update(p.read_bytes())
        for p in [root/'studio_core.py',root/'studio_v2.py',root/'vendor/kit/body.js',root/'vendor/kit/rig.js']:digest.update(p.read_bytes())
        for name in ('SOURCE.json','VERSION.json','AUTHORS.md'):
            if (root/name).is_file():digest.update((root/name).read_bytes())
        return digest.hexdigest()
    core.fingerprint=fingerprint

    def rename(path,oldid,newid):
        result=old['rename_part'](path,oldid,newid)
        def remap(v):
            if isinstance(v,dict):return {(newid if k==oldid else 'expression:'+newid if k=='expression:'+oldid else k):remap(x) for k,x in v.items()}
            if isinstance(v,list):return [remap(x) for x in v]
            if v==oldid:return newid
            if v=='expression:'+oldid:return 'expression:'+newid
            if v==f'parts/{oldid}.png':return f'parts/{newid}.png'
            return v
        for file in ('project.json','assembly-v4.json','parts-manifest.json','rig.json'):
            data=core.read(path/file)
            if file=='project.json':
                # Native source metadata and original code remain untouched.
                source=data.pop('source',{});data=remap(data);data['source']=source
            else:data=remap(data)
            core.write(path/file,data)
        return result
    core.rename_part=rename

    def save_features(path,data):
        c=core.read(path/'project.json');before=copy.deepcopy(c)
        for key in FEATURES:
            if key in data:
                if data[key] is None:c['model'].pop(key,None)
                else:c['model'][key]=copy.deepcopy(data[key])
        if 'engine' in data:
            if data['engine'] not in ('generic','layered'):raise ValueError('请选择通用或高级部件运行时')
            c['engine']=data['engine']
        c['schema']=2
        for name in {p.get('group') for p in c['model'].get('physics',{}).get('parts',{}).values()}:
            key=str(name)+'Physics'
            c['model']['tune'].setdefault(key,{'strength':1,'stiffness':1,'damping':1})
            c.setdefault('defaults',{}).setdefault('tune',{})[key]=copy.deepcopy(c['model']['tune'][key])
        if c['model'].get('seatedLegs'):
            c['model']['tune'].setdefault('sitLife',{'head':1,'expression':1,'breath':1})
            c.setdefault('defaults',{}).setdefault('tune',{})['sitLife']=copy.deepcopy(c['model']['tune']['sitLife'])
        # Validate in an isolated temporary snapshot, so a rejected edit never replaces saved data.
        with core.LOCK:
            with __import__('tempfile').TemporaryDirectory(dir=root/'tests') as folder:
                t=Path(folder)
                for f in ('assembly-v4.json','rig.json','parts-manifest.json'):shutil.copy2(path/f,t/f)
                core.write(t/'project.json',c)
                # Geometry/reference checks below are independent of PNG copying.
                built=effective(t)
                if 'expressionFace' in built:
                    ids={p['id'] for p in built['parts']}
                    for eye in built['expressionFace'].get('normalEyes',{}).values():
                        if any(id not in ids for id in eye.values()):raise ValueError('眼睛绑定部件不存在')
            def check(v):
                if isinstance(v,dict):
                    for x in v.values():check(x)
                elif isinstance(v,list):
                    for x in v:check(x)
                elif type(v) in (int,float):core.number(v,-1e9,1e9)
            check(c['model']);core.write(path/'project.json',c)
        return {'ok':True}
    core.save_features=save_features

    def native(path,export=False):
        source=path/'source-pack'
        if not (source/'figure.json').is_file():raise ValueError('该工程没有原包副本')
        manifest=core.read(source/'figure.json')
        for key in ('entry','model'):
            if not core.inside(source,manifest[key]).is_file():raise ValueError('原包入口或模型缺失')
        if not export:return {'base':f'/p/{path.name}/source-pack/','native':True,'report':{'import_notice':'原包模式：保留原动作代码；编辑副本的修改不会写入这里。'}}
        digest=hashlib.sha256()
        for p in sorted(source.rglob('*')):
            if p.is_file():digest.update(p.relative_to(source).as_posix().encode());digest.update(p.read_bytes())
        name=f"{path.name}-original-{digest.hexdigest()[:12]}.zip";target=root/'exports'/name
        core.archive(source,target);return {'ok':True,'zip':str(target),'url':'/exports/'+name,'native':True,'fingerprint':digest.hexdigest()}
    core.native_pack=native
