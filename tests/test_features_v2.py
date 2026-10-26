import copy,hashlib,json,shutil,sys,tempfile,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import studio_core as c

class FeaturesTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=c.ROOT/'tests');self.root=Path(self.tmp.name);self.old=c.PROJECTS;c.PROJECTS=self.root/'projects';c.PROJECTS.mkdir()
  self.p=c.import_project(c.ROOT/'projects/xitelali-2-1-0','project','copy-fixture')
 def tearDown(self):c.PROJECTS=self.old;self.tmp.cleanup()
 def test_all_authored_data_and_pngs_survive_build(self):
  src=c.read(self.p/'source-pack/model.json');built=c.effective_model(self.p)
  self.assertEqual(src['expressionFace']['expressionLayouts'],built['expressionFace']['expressionLayouts'])
  self.assertEqual(src['expressionFace']['blinkCalibration'],built['expressionFace']['blinkCalibration'])
  self.assertEqual(src['expressionFace']['authoredLashTransitions'],built['expressionFace']['authoredLashTransitions'])
  self.assertEqual(len(built['expressionFace']['expressionLayouts']),19)
  target=self.root/'build';c.build(self.p,target)
  for original in src['parts']:
   self.assertEqual((self.p/'source-pack'/original['file']).read_bytes(),(target/f"parts/{original['id']}.png").read_bytes())
  self.assertEqual((target/'figure.js').read_text(encoding='utf-8'),c.bundle_runtime())
 def test_rename_updates_every_calibration_role_and_preserves_geometry(self):
  before=c.effective_model(self.p);c.rename_part(self.p,'part_28','近眼睫毛');after=c.effective_model(self.p)
  self.assertEqual(after['expressionFace']['normalEyes']['near']['lid'],'近眼睫毛')
  self.assertTrue(c.validate(self.p)['ok']);self.assertEqual(before['expressionFace']['blinkCalibration'],after['expressionFace']['blinkCalibration'])
  self.assertIn('近眼睫毛',[p['id'] for p in after['expressionFace']['expressionLayouts']['angry']['parts']])
  self.assertTrue((self.p/'source-pack/tex/part_28.png').is_file())
 def test_arbitrary_role_and_sprite_names_export(self):
  c.rename_part(self.p,'love_eyeL','心形_近');c.rename_part(self.p,'part_27','远侧上睑')
  model=c.effective_model(self.p);self.assertEqual(model['expressionFace']['spriteRoles']['心形_近']['state'],'love')
  target=self.root/'renamed';c.build(self.p,target);self.assertTrue((target/'parts/心形_近.png').is_file())
 def test_source_roundtrip_keeps_native_and_all_calibrations(self):
  z=self.root/'source.zip';c.archive(self.p,z)
  unpack=self.root/'unpacked';unpack.mkdir()
  with zipfile.ZipFile(z) as archive:archive.extractall(unpack)
  other=c.import_project(unpack,'project','restored');self.assertEqual(c.effective_model(self.p),c.effective_model(other));self.assertEqual((self.p/'source-pack/figure.js').read_bytes(),(other/'source-pack/figure.js').read_bytes())
 def test_runtime_changes_invalidate_preview_fingerprint(self):
  before=c.fingerprint(self.p)
  with __import__('unittest.mock').mock.patch.object(c,'ROOT',c.ROOT):
   a=c.read(self.p/'assembly-v4.json');a['blinkCalibration']['near']['end']['box'][0]+=.125;c.write(self.p/'assembly-v4.json',a)
  self.assertNotEqual(before,c.fingerprint(self.p))
 def test_invalid_eye_reference_is_rejected(self):
  f=copy.deepcopy(c.read(self.p/'project.json')['model']['expressionFace']);f['normalEyes']['near']['lid']='missing'
  with self.assertRaises(ValueError):c.save_features(self.p,{'expressionFace':f})
  self.assertNotEqual(c.read(self.p/'project.json')['model']['expressionFace']['normalEyes']['near']['lid'],'missing')
 def test_native_export_keeps_original_entry_bytes(self):
  before=(self.p/'source-pack/figure.js').read_bytes();a=c.read(self.p/'assembly-v4.json');a['parts'][0]['x']+=99;c.write(self.p/'assembly-v4.json',a)
  record=c.native_pack(self.p,True)
  with zipfile.ZipFile(record['zip']) as z:self.assertEqual(z.read('figure.js'),before);self.assertIsNone(z.testzip())
  Path(record['zip']).unlink()
 def test_export_preserves_sample_author_and_tool_provenance(self):
  config=c.read(self.p/'project.json');out=self.root/'attributed';c.build(self.p,out)
  manifest=c.read(out/'figure.json');source=c.read(out/'SOURCE.json')
  self.assertEqual(manifest['name']['zh'],config['package']['name']);self.assertEqual(manifest['author'],config['package']['author'])
  self.assertEqual(c.read(out/'AUTHORSHIP.json'),config['authorship'])
  self.assertEqual(source['tool']['author'],c.read(c.ROOT/'VERSION.json')['author'])
  self.assertEqual((self.p/'source-pack/figure.js').read_bytes(),(c.ROOT/'projects/xitelali-2-1-0/source-pack/figure.js').read_bytes())

if __name__=='__main__':unittest.main()
