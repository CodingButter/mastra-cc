import contextlib, io, json, pathlib, runpy, tempfile, unittest
from unittest.mock import patch

class SourceIntegrityGate(unittest.TestCase):
 def run_probe(self, mutate):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);source=root/'source';output=root/'output';output.mkdir()
   (source/'installed/consumer/node_modules').mkdir(parents=True)
   for trial in ('t1','t2','t3'):
    (source/trial).mkdir()
    for name in ('document.txt','expected.txt'):(source/trial/name).write_text('saved content\n')
   class Process:
    pid=123456789
    def __init__(self,args,**kwargs):
     self.run=pathlib.Path(args[-2]);(self.run/'driver.log').write_text('fixture child completed\n')
    def wait(self,timeout=None):
     if mutate and self.run.name=='t1':(source/'t1/document.txt').write_text('unexpected mutation\n')
     return 0
   script=pathlib.Path(__file__).with_name('run.py')
   with patch('sys.argv',[str(script),str(source)]),patch('tempfile.mkdtemp',return_value=str(output)),patch('subprocess.Popen',Process),patch('os.killpg'),contextlib.redirect_stdout(io.StringIO()):
    with self.assertRaises(SystemExit) as result:runpy.run_path(str(script),run_name='__main__')
   return result.exception.code,json.loads((output/'t1/outcome.json').read_text())
 def test_unchanged_source_passes(self):
  code,outcome=self.run_probe(False);self.assertEqual(code,0);self.assertTrue(outcome['sourceUnchanged'])
 def test_changed_source_fails_despite_successful_child(self):
  code,outcome=self.run_probe(True);self.assertEqual(code,1);self.assertEqual(outcome['exitCode'],0);self.assertFalse(outcome['sourceUnchanged'])

if __name__=='__main__':unittest.main()
