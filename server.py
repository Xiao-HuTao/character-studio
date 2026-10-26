"""Character Studio HTTP app. Python standard library; only 127.0.0.1."""
import json
import mimetypes
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs
import studio_core as core

ROOT=core.ROOT
WEB=ROOT/'web'

def summary(path):
    config=core.read(path/'project.json');assembly=core.read(path/'assembly-v4.json',{'parts':[]})
    rig=core.read(path/'rig.json',{'nodes':{}})
    return {'id':path.name,'name':config['name'],'path':str(path),'parts':len(assembly['parts']),
            'nodes':len(rig['nodes']),'canvas':config['model']['canvas'],'version':config['package']['version'],'notice':config.get('source',{}).get('conversion_note',''),'hasNative':(path/'source-pack/figure.json').is_file(),'author':config['package'].get('author',''),'authorUrl':config.get('authorship',{}).get('author',{}).get('url','')}

def auto_rig(path):
    data=core.state(path);w,h=data['project']['model']['canvas'];cx=data['project']['model']['center_x'];feet=data['project']['model']['feet_y']
    coords={'body':[cx,feet],'torso':[cx,h*.64],'head':[cx,h*.44],'hair':[cx,h*.14], 'eyes':[cx,h*.36],'iris':[cx,h*.36],'brow':[cx,h*.31],'mouth':[cx,h*.43],
            'armNear':[cx-w*.14,h*.51],'armFar':[cx+w*.14,h*.51],'legNear':[cx-w*.08,h*.75],'legFar':[cx+w*.08,h*.75]}
    rig={'nodes':{k:{'pivot':[round(v[0]),round(v[1])],'parent':core.PARENTS[k]} for k,v in coords.items()},'assign':{}}
    names={p['id']:p.get('cn',p['id']) for p in data['manifest'].get('parts',[])}
    for p in data['assembly']['parts']:
        text=p['id']+' '+names.get(p['id'],'');left=p['x']+p['w']/2<cx;node='torso'
        for pattern,semantic in [(r'iris|pupil|虹膜|瞳','iris'),(r'brow|眉','brow'),(r'eye|lash|眼','eyes'),(r'mouth|嘴','mouth'),(r'face|脸','head'),(r'hair|braid|bang|发|辫','hair'),(r'arm|sleeve|hand|臂|袖|手','armNear' if left else 'armFar'),(r'leg|boot|foot|thigh|腿|靴|脚','legNear' if left else 'legFar')]:
            if re.search(pattern,text,re.I):node=semantic;break
        rig['assign'][p['id']]=node
    core.check_rig(rig);core.write(path/'rig.json',rig);return rig

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');super().end_headers()
    def send_bytes(self,raw,kind='application/json; charset=utf-8',status=200):
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def json(self,data,status=200):self.send_bytes(json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf-8'),status=status)
    def file(self,path):
        path=Path(path)
        if not path.is_file():return self.send_error(404)
        kind=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if path.suffix=='.js':kind='text/javascript; charset=utf-8'
        self.send_bytes(path.read_bytes(),kind)
    def selected(self,query):
        pid=query.get('project',[None])[0]
        if not pid:raise ValueError('请从工程首页打开项目；本页面缺少工程 ID')
        return core.project_path(pid)
    def do_GET(self):
        try:
            url=urlsplit(self.path);path=unquote(url.path);query=parse_qs(url.query)
            if path=='/api/health':return self.json({'app':'character-studio','version':'2.0.0','root':str(ROOT)})
            if path=='/api/projects':
                return self.json([summary(p) for p in sorted(core.PROJECTS.iterdir()) if p.is_dir() and (p/'project.json').is_file()])
            if path=='/api/deleted-projects':return self.json(core.deleted_projects())
            if path=='/api/legacy-projects':return self.json(core.read(ROOT/'legacy-before-studio/projects.json',[]))
            if path.startswith('/api/'):
                project=self.selected(query);config=core.read(project/'project.json')
                if path=='/api/effective-model':return self.json(core.effective_model(project))
                if path=='/api/features':return self.json({'engine':config.get('engine','generic'),**{k:config['model'].get(k) for k in __import__('studio_v2').FEATURES}})
                if path in ('/api/current','/api/project'):return self.json({'path':str(project),'name':config['name'],**config})
                if path=='/api/rig':return self.json(core.read(project/'rig.json',{'nodes':{},'assign':{}}))
                if path=='/api/parts':return self.json({p.stem:{'exists':True,'mtime':int(p.stat().st_mtime*1000),'size':p.stat().st_size} for p in (project/'parts').glob('*.png')})
                if path=='/api/check':return self.json(core.validate(project))
                if path=='/api/tune':return self.json({'tune':config['model']['tune'],'defaults':config.get('defaults',{}).get('tune',core.TUNE)})
                if path=='/api/packs':return self.json({'default':project.name,'packs':[{'folder':project.name,'name':config['name'],'version':config['package']['version']}]})
                if path=='/api/legacy-projects':return self.json(core.read(ROOT/'legacy-before-studio/projects.json',[]))
                return self.send_error(404)
            if path in ('/','/index.html'):return self.file(WEB/'index.html')
            if path in ('/SOURCE.json','/AUTHORS.md','/VERSION.json'):return self.file(ROOT/path[1:])
            if path.startswith('/skills/'):return self.file(core.inside(ROOT/'skills',path[8:]))
            if path.startswith('/web/'):return self.file(core.inside(WEB,path[5:]))
            if path.startswith('/vendor/'):return self.file(core.inside(ROOT/'vendor',path[8:]))
            if path.startswith('/builds/') or path.startswith('/exports/'):return self.file(core.inside(ROOT,path.lstrip('/')))
            if path.startswith('/runtime/'):return self.file(core.inside(ROOT/'runtime',path[9:]))
            match=re.fullmatch(r'/p/([a-z0-9-]+)/(.*)',path)
            if match:
                project=core.project_path(match[1]);relative=match[2]
                if relative in ('editor.html','bind.html','export.html','features.html','calibration.html'):return self.file(WEB/relative)
                if relative.startswith('source-pack/'):return self.file(core.inside(project,relative))
                if relative.startswith('motion/'):
                    relative=relative[7:] or 'index.html'
                    return self.file(core.inside(WEB/'motion',relative))
                if relative in ('parts-manifest.json','assembly-v4.json','rig.json','project.json','reference.png','thumbnail.png') or relative.startswith(('parts/','feat/')):
                    return self.file(core.inside(project,relative))
            return self.send_error(404)
        except (ValueError,KeyError,TypeError,OSError) as error:self.json({'error':str(error)},400)
    def do_POST(self):
        try:
            origin=self.headers.get('Origin')
            if origin and origin!=f'http://{self.headers.get("Host")}':return self.json({'error':'仅接受本机页面请求'},403)
            size=int(self.headers.get('Content-Length','0'))
            if not 0<=size<=40*1024*1024:raise ValueError('单次请求最多 40 MB')
            raw=self.rfile.read(size);url=urlsplit(self.path);query=parse_qs(url.query);route=url.path
            data={} if route in ('/api/upload','/api/thumbnail') else json.loads(raw or b'{}')
            with core.LOCK:
                if route=='/api/new':
                    project=core.new_project(data['id'],data.get('name'),data.get('canvas',[1037,1517]));return self.json(summary(project))
                if route=='/api/delete-project':return self.json(core.delete_project(data['id']))
                if route=='/api/restore-project':return self.json(core.restore_project(data['token']))
                if route in ('/api/import','/api/import-pack','/api/import-images','/api/add-project'):
                    mode={'/api/import-pack':'pack','/api/import-images':'images','/api/add-project':'project'}.get(route,data.get('mode','auto'))
                    project=core.import_project(data['path'].strip().strip('"'),mode,data.get('id') or None,data.get('name') or None,data.get('canvas'))
                    return self.json(summary(project))
                project=self.selected(query)
                if route=='/api/features':return self.json(core.save_features(project,data))
                if route=='/api/native-preview':return self.json(core.native_pack(project))
                if route=='/api/native-export':return self.json(core.native_pack(project,True))
                if route=='/api/calibration':
                    assembly=core.read(project/'assembly-v4.json');scope=data['scope']
                    if scope=='expression':
                        if data['state'] not in core.FACES:raise ValueError('未知表情')
                        core.check_assembly(data['layout']);assembly.setdefault('expressionLayouts',{})[data['state']]=data['layout']
                        if 'transition' in data:
                            if data['transition'] is None:assembly.setdefault('authoredLashTransitions',{}).pop(data['state'],None)
                            else:assembly.setdefault('authoredLashTransitions',{})[data['state']]=data['transition']
                    elif scope=='blink':
                        side=data['side'];phase=data['phase']
                        if side not in ('near','far') or phase not in ('start','end'):raise ValueError('未知眨眼端点')
                        pose=data['pose'];core.check_assembly({'parts':[{'id':'endpoint',**dict(zip(('x','y','w','h'),pose['box'])),'rot':pose.get('rotation',0),'z':pose.get('z',0)}]})
                        assembly.setdefault('blinkCalibration',{'schema':1,'interpolation':'smoothstep'}).setdefault(side,{})[phase]=pose
                    else:raise ValueError('未知校准类型')
                    core.write(project/'assembly-v4.json',assembly);return self.json({'ok':True})
                if route=='/api/rename-part':return self.json(core.rename_part(project,data['old'],data['new']))
                if route=='/api/save':
                    core.check_assembly(data);previous=core.read(project/'assembly-v4.json',{});previous.update(data);core.write(project/'assembly-v4.json',previous);return self.json({'ok':True})
                if route=='/api/save-rig':
                    core.check_rig(data);core.write(project/'rig.json',data);return self.json({'ok':True})
                if route=='/api/auto-rig':return self.json(auto_rig(project))
                if route=='/api/upload':
                    key=core.part_id(query.get('id',[''])[0]);target=project/'parts'/f'{key}.png';temporary=target.with_suffix('.upload')
                    temporary.write_bytes(raw)
                    try:core.png_size(temporary)
                    except Exception:temporary.unlink();raise
                    temporary.replace(target);return self.json({'ok':True,'id':key,'mtime':int(target.stat().st_mtime*1000)})
                if route=='/api/thumbnail':
                    target=project/'thumbnail.upload';target.write_bytes(raw)
                    try:core.png_size(target)
                    except Exception:target.unlink();raise
                    target.replace(project/'thumbnail.png');return self.json({'ok':True})
                if route=='/api/delete':
                    key=core.part_id(query.get('id',[''])[0]);target=project/'parts'/f'{key}.png'
                    if target.is_file():
                        trash=project/'trash';trash.mkdir(exist_ok=True);target.replace(trash/f'{time.time_ns()}-{key}.png')
                    return self.json({'ok':True})
                if route=='/api/restore-part':
                    key=core.part_id(query.get('id',[''])[0]);target=project/'parts'/f'{key}.png'
                    candidates=sorted((project/'trash').glob(f'*-{key}.png')) if (project/'trash').is_dir() else []
                    if not target.exists():
                        if not candidates:raise ValueError('回收目录中没有这个部件')
                        candidates[-1].replace(target)
                    return self.json({'ok':True})
                if route=='/api/project':
                    config=core.read(project/'project.json')
                    package=data.get('package',config['package']);core.identifier(package['id'])
                    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?',package['version']):raise ValueError('版本号格式应为 0.1.0')
                    if any(not isinstance(package.get(k),str) or not package[k].strip() for k in ('name','author','license')):raise ValueError('名称、作者和许可不能为空')
                    config['package']={k:package[k].strip() for k in ('id','version','name','author','license')};config['name']=package['name']
                    if 'canvas' in data:config['model']['canvas']=core.canvas_size(data['canvas'])
                    for key in ('center_x','feet_y','logo_scale'):
                        if key in data:config['model'][key]=core.number(data[key],.00001 if key=='logo_scale' else -100000)
                    core.write(project/'project.json',config)
                    manifest=core.read(project/'parts-manifest.json',{'parts':[]});manifest['canvas']=config['model']['canvas'];core.write(project/'parts-manifest.json',manifest)
                    return self.json(config)
                if route=='/api/save-tune':
                    config=core.read(project/'project.json');core.validate_tune(data['tune'],config['model']['tune']);config['model']['tune']=data['tune'];core.write(project/'project.json',config);return self.json({'saved':True})
                if route=='/api/preview':return self.json(core.preview(project))
                if route=='/api/export-pack':return self.json(core.export(project))
                if route=='/api/export-project':
                    target=ROOT/'exports'/f'{project.name}-source.zip';target.parent.mkdir(exist_ok=True)
                    with __import__('zipfile').ZipFile(target,'w',__import__('zipfile').ZIP_DEFLATED) as z:
                        for file in sorted(project.rglob('*')):
                            rel=file.relative_to(project)
                            if file.is_file() and rel.parts[0] not in ('trash','.history'):z.write(file,rel.as_posix())
                    return self.json({'url':'/exports/'+target.name,'path':str(target)})
                return self.send_error(404)
        except (ValueError,KeyError,TypeError,OSError) as error:self.json({'error':str(error)},400)

def main():
    core.PROJECTS.mkdir(exist_ok=True);(ROOT/'exports').mkdir(exist_ok=True)
    port=int(sys.argv[1]) if len(sys.argv)>1 else 8780
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Character Studio: http://127.0.0.1:{port}/',flush=True);server.serve_forever()

if __name__=='__main__':main()
