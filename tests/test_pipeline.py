"""Meaningful build contract tests; no image library or browser needed."""
import copy
import json
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import studio_core as core

def png(w=4,h=6):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\0\xff\xff'*w)*h))+chunk(b'IEND',b'')

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=core.ROOT/'tests');self.root=Path(self.temp.name);self.old=core.PROJECTS;core.PROJECTS=self.root/'projects';core.PROJECTS.mkdir()
        self.project=core.new_project('fixture','测试角色',[800,1200])
        (self.project/'parts/face.png').write_bytes(png())
        core.write(self.project/'assembly-v4.json',{'parts':[{'id':'face','x':200,'y':300,'w':80,'h':120,'rot':15,'z':4}],'removed':[]})
        core.write(self.project/'rig.json',{'nodes':{k:{'pivot':[400,600],'parent':v} for k,v in core.PARENTS.items()},'assign':{'face':'head'}})
    def tearDown(self):core.PROJECTS=self.old;self.temp.cleanup()
    def test_build_preserves_geometry_and_zip_root(self):
        target=self.root/'package';core.build(self.project,target);model=core.read(target/'model.json');self.assertEqual(model['canvas'],[800,1200]);self.assertEqual(model['parts'][0]['rot'],15)
        out=self.root/'pack.zip';core.archive(target,out)
        with zipfile.ZipFile(out) as archive:self.assertIn('figure.json',archive.namelist());self.assertNotIn('package/figure.json',archive.namelist())
    def test_missing_texture_and_binding_stop_build(self):
        (self.project/'parts/face.png').unlink();self.assertFalse(core.validate(self.project)['ok'])
        with self.assertRaises(ValueError):core.build(self.project,self.root/'bad')
        self.assertFalse((self.root/'bad').exists())
    def test_hidden_and_removed_not_exported(self):
        assembly=core.read(self.project/'assembly-v4.json');assembly['parts'].append({'id':'hidden','x':0,'y':0,'w':20,'h':20,'z':5,'hidden':True});core.write(self.project/'assembly-v4.json',assembly)
        core.build(self.project,self.root/'hidden-test');self.assertEqual(len(core.read(self.root/'hidden-test/model.json')['parts']),1)
    def test_feature_import_roundtrip_and_tuning(self):
        source=self.root/'source';core.build(self.project,source);(source/'feat').mkdir();(source/'feat/mouth.png').write_bytes(png())
        model=core.read(source/'model.json');model['feat']={'box':[200,300,80,120],'mouths':{'smile':'feat/mouth.png'}};model['tune']['wave']['angle']=.35;core.write(source/'model.json',model)
        imported=core.import_project(source,'pack','roundtrip');core.build(imported,self.root/'roundtrip-output');result=core.read(self.root/'roundtrip-output/model.json')
        self.assertEqual(result['tune']['wave']['angle'],.35);self.assertEqual((self.root/'roundtrip-output/feat/mouth.png').read_bytes(),png())
    def test_cycle_and_unknown_parent_rejected(self):
        rig=core.read(self.project/'rig.json');rig['nodes']['body']['parent']='head'
        with self.assertRaises(ValueError):core.check_rig(rig)
        rig['nodes']['body']['parent']='missing'
        with self.assertRaises(ValueError):core.check_rig(rig)
    def test_unsafe_paths_and_invalid_numbers_rejected(self):
        with self.assertRaises(ValueError):core.inside(self.project,'../escape')
        with self.assertRaises(ValueError):core.identifier('../bad')
        tune=copy.deepcopy(core.TUNE);tune['blink']=float('nan')
        with self.assertRaises(ValueError):core.validate_tune(tune)
    def test_custom_parent_pivots_preserved(self):
        rig=core.read(self.project/'rig.json');rig['nodes']['wristFar']={'pivot':[700,850],'parent':'armFar'};rig['assign']['face']='wristFar';core.write(self.project/'rig.json',rig)
        core.build(self.project,self.root/'custom');model=core.read(self.root/'custom/model.json');self.assertEqual(model['nodes']['wristFar']['pivot'],[700,850]);self.assertEqual(model['parts'][0]['node'],'wristFar')
    def test_corrupt_png_rejected(self):
        (self.project/'parts/face.png').write_bytes(png()[:-8])
        with self.assertRaises(ValueError):core.png_size(self.project/'parts/face.png')
    def test_failed_import_does_not_leave_partial_project(self):
        source=self.root/'bad-source';source.mkdir();(source/'bad.png').write_bytes(b'not a PNG')
        with self.assertRaises(ValueError):core.import_project(source,'images','bad-import')
        self.assertFalse((core.PROJECTS/'bad-import').exists())
        self.assertFalse(any(core.PROJECTS.glob('import-*')))
    def test_missing_optional_features_warn_but_keep_original_mouth(self):
        result=core.validate(self.project);self.assertTrue(result['ok']);self.assertTrue(result['warnings'])
    def test_rename_updates_image_geometry_binding_and_feature_reference(self):
        config=core.read(self.project/'project.json');config['model']['feat']={'mouths':{'smile':'./parts/face.png'},'box':[200,300,80,120]};core.write(self.project/'project.json',config)
        core.write(self.project/'parts-manifest.json',{'canvas':[800,1200],'parts':[{'id':'face','cn':'face','box':[200,300,80,120],'z':4}]})
        core.rename_part(self.project,'face','脸部')
        self.assertFalse((self.project/'parts/face.png').exists());self.assertEqual((self.project/'parts/脸部.png').read_bytes(),png())
        self.assertEqual(core.read(self.project/'assembly-v4.json')['parts'][0],{'id':'脸部','x':200,'y':300,'w':80,'h':120,'rot':15,'z':4})
        self.assertEqual(core.read(self.project/'rig.json')['assign'],{'脸部':'head'})
        self.assertEqual(core.read(self.project/'project.json')['model']['feat']['mouths']['smile'],'parts/脸部.png')
        core.build(self.project,self.root/'renamed-build');self.assertEqual(core.read(self.root/'renamed-build/model.json')['parts'][0]['file'],'tex/脸部.png')
    def test_rename_collision_and_unsafe_name_leave_original_unchanged(self):
        (self.project/'parts/other.png').write_bytes(png(2,3));before=core.read(self.project/'assembly-v4.json')
        for new in ['other','../escape']:
            with self.assertRaises(ValueError):core.rename_part(self.project,'face',new)
        self.assertEqual(core.read(self.project/'assembly-v4.json'),before);self.assertEqual((self.project/'parts/face.png').read_bytes(),png())
    def test_case_only_rename(self):
        core.rename_part(self.project,'face','Face');self.assertEqual(core.read(self.project/'rig.json')['assign'],{'Face':'head'});self.assertTrue((self.project/'parts/Face.png').is_file())
    def test_rename_rolls_back_after_failed_json_write(self):
        before={p.name:p.read_bytes() for p in self.project.glob('*.json')};write=core.write
        def failing_write(path,data):
            if Path(path).name=='rig.json':raise OSError('test write failure')
            return write(path,data)
        with patch.object(core,'write',side_effect=failing_write):
            with self.assertRaises(OSError):core.rename_part(self.project,'face','renamed')
        self.assertEqual({p.name:p.read_bytes() for p in self.project.glob('*.json')},before)
        self.assertEqual((self.project/'parts/face.png').read_bytes(),png());self.assertFalse((self.project/'parts/renamed.png').exists())
    def test_delete_and_restore_project_preserve_all_files(self):
        before={p.relative_to(self.project).as_posix():p.read_bytes() for p in self.project.rglob('*') if p.is_file()}
        result=core.delete_project('fixture');self.assertFalse(self.project.exists());self.assertEqual(len(core.deleted_projects()),1)
        core.restore_project(result['token']);self.assertEqual(core.deleted_projects(),[])
        self.assertEqual({p.relative_to(self.project).as_posix():p.read_bytes() for p in self.project.rglob('*') if p.is_file()},before)
    def test_restore_never_overwrites_an_existing_project(self):
        result=core.delete_project('fixture');core.new_project('fixture','New',[400,600])
        with self.assertRaises(ValueError):core.restore_project(result['token'])
        self.assertEqual(core.read(self.project/'project.json')['name'],'New');self.assertEqual(len(core.deleted_projects()),1)
    def official_fixture(self):
        source=self.root/'official';source.mkdir()
        model={'units':{'S':.2,'X0':500,'FEET':1000,'DS':.6,'featDS':1},'pivots':{'body':[128,256],'waist':[128,180],'neck':[130,100],'head':[135,110]},
               'parts':[{'id':'face','tex':'face','parent':'headMid','box':[100,100,60,20],'z':8},
                        {'id':'skirt','tex':'skirt','parent':'skirt','box':[80,170,80,60],'z':5},
                        {'id':'skirt_sit','tex':'skirt_sit','parent':'skirtSit','box':[70,170,110,70],'z':5.3}],
               'feat':{'eyes':{'eyeL':{'ball':[420,510,424,516],'iris':[421,511,423,515],'lash':[419,509,425,513]},'eyeR':{'ball':[580,510,584,516]}},
                       'sprites':{'neutral_mouth':[500,600,504,606],'happy_mouth':[497,598,505,604],'drag_mouth':[497,598,505,604],
                                  'dizzy_eyeL':[420,510,424,516],'dizzy_eyeR':[580,510,584,516],'drag_eyeL':[420,510,424,516],'drag_eyeR':[580,510,584,516]}},
               'view':[-12,-8,268,272],'schemes':[{'id':'deepseek','accent':'#4d6bfe'}],'outfits':[{'id':'maid'}]}
        assets=['tex/'+p['tex']+'.png' for p in model['parts']]+['feat/'+name+'.png' for name in model['feat']['sprites']]+['thumbs/deepseek.png','schemes/other/tex/face.png']
        for side,eye in model['feat']['eyes'].items():assets.extend('feat/'+side+'_'+layer+'.png' for layer in eye)
        for rel in assets:
            dest=source/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(png())
        core.write(source/'model.json',model);core.write(source/'figure.json',{'id':'official-test','name':{'zh':'Official'},'version':'1.0.0','author':'Official author','thumb':'thumbs/deepseek.png'})
        return source
    def test_official_mesh_units_textures_and_pivots_import(self):
        source=self.official_fixture();project=core.import_project(source,'pack','official-project');data=core.state(project)
        face=next(p for p in data['assembly']['parts'] if p['id']=='face')
        self.assertEqual([face[k] for k in ('x','y','w','h')],[360,220,300,100]);self.assertEqual(data['rig']['assign']['face'],'head')
        self.assertEqual(data['rig']['nodes']['head']['pivot'],[510,220]);self.assertEqual(data['project']['package']['id'],'official-test-studio')
        self.assertEqual(data['rig']['nodes']['eyes']['pivot'],[502,513])
        self.assertTrue(core.validate(project)['ok']);self.assertEqual((project/'thumbnail.png').read_bytes(),png())
        self.assertEqual((project/'source-pack/model.json').read_bytes(),(source/'model.json').read_bytes())
        self.assertTrue((project/'source-pack/schemes/other/tex/face.png').is_file())
        restored=core.import_project(project,'project','official-restored')
        self.assertTrue((restored/'source-pack/schemes/other/tex/face.png').is_file())
    def test_official_face_boxes_sides_and_hidden_pose_survive_build(self):
        project=core.import_project(self.official_fixture(),'pack','official-project');core.build(project,self.root/'official-build');model=core.read(self.root/'official-build/model.json')
        self.assertNotIn('skirt_sit',{p['id'] for p in model['parts']});self.assertIn('skirt_sit',{p['id'] for p in core.state(project)['assembly']['parts']})
        iris=next(p for p in model['parts'] if p['id']=='eye_near_iris');self.assertEqual(iris['side'],'near');self.assertEqual(iris['box'],[421,511,2,4])
        self.assertEqual(model['feat']['mouthBoxes']['smile'],[497,607,8,6]);self.assertEqual(model['feat']['eyeBoxesByState']['dizzy']['far'],[580,510,4,6])
        for rel in core.feature_files(model):self.assertTrue((self.root/'official-build'/rel).is_file())
    def test_unknown_part_format_has_actionable_error(self):
        source=self.root/'unknown';source.mkdir();core.write(source/'model.json',{'parts':[{'id':'bad','box':[1,2,3,4]}]})
        with self.assertRaisesRegex(ValueError,'file'):core.import_project(source,'pack','unknown-format')
        self.assertFalse((core.PROJECTS/'unknown-format').exists())

if __name__=='__main__':unittest.main()
