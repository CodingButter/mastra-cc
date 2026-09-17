import pathlib, tempfile, os, json, shutil, subprocess, hashlib, sys, signal
source_batch=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path(tempfile.mkdtemp(prefix='mousepad-reopen.')); consumer=root/'consumer'; consumer.mkdir()
os.symlink(source_batch/'installed/consumer/node_modules',consumer/'node_modules')
shutil.copyfile(pathlib.Path(__file__).with_name('driver.mjs'),consumer/'model-driver.mjs')
print('REOPEN:',root,flush=True)
failures=[]
for trial in ['t1','t2','t3']:
 run=root/trial;run.mkdir();(run/'before.txt').write_text('')
 source=source_batch/trial/'document.txt';data=source.read_bytes();expected=(source_batch/trial/'expected.txt').read_bytes();assert data==expected
 (run/'reopen-declaration.json').write_text(json.dumps({'source':str(source),'expected':expected.decode(),'sourceSha256':hashlib.sha256(data).hexdigest(),'driverSha256':hashlib.sha256((consumer/'model-driver.mjs').read_bytes()).hexdigest()}))
 with (run/'session.txt').open('w') as log:
  proc=subprocess.Popen(['bash',str(pathlib.Path(__file__).resolve().parents[1]/'model-session.sh'),'--display',str(run),str(consumer)],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=proc.wait(timeout=90)
  except subprocess.TimeoutExpired:code=124
  finally:
   try:os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   proc.wait()
 print(trial,'exit',code,flush=True)
 unchanged=hashlib.sha256(source.read_bytes()).hexdigest()==hashlib.sha256(data).hexdigest()
 if code or not unchanged:failures.append(trial);print((run/'driver.log').read_text()[-1500:],flush=True)
 (run/'outcome.json').write_text(json.dumps({'exitCode':code,'sourceUnchanged':unchanged}))
print('FAILED:',failures,flush=True)
sys.exit(bool(failures))
