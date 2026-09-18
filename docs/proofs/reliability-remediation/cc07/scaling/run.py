import pathlib, tempfile, os, json, shutil, subprocess, hashlib, sys, signal

session, modules, mastra_entry = map(lambda value: pathlib.Path(value).resolve(), sys.argv[1:4])
root = pathlib.Path(tempfile.mkdtemp(prefix='cc01-live.'))
consumer = root / 'consumer'
consumer.mkdir()
os.symlink(modules, consumer / 'node_modules')
driver = pathlib.Path(__file__).with_name('driver.mjs')
shutil.copyfile(driver, consumer / 'model-driver.mjs')
run = root / 'trial'
run.mkdir()
(run / 'before.txt').write_text('')
(root / 'declaration.json').write_text(json.dumps({
    'session': str(session), 'modules': str(modules), 'mastraEntry': str(mastra_entry),
    'driverSha256': hashlib.sha256(driver.read_bytes()).hexdigest(),
    'sessionSha256': hashlib.sha256(session.read_bytes()).hexdigest(),
    'claim': 'live occlusion, permitted foreground route, focus restoration and layout change; one fixture, one desk',
}, indent=2))
print('NATIVE:', root, flush=True)
with (run / 'session.txt').open('w') as log:
    proc = subprocess.Popen(['bash', str(session), '--display', str(run), str(consumer)],
        env={**os.environ, 'CC01_MASTRA_ENTRY': str(mastra_entry)},
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        code = proc.wait(timeout=180)
    except subprocess.TimeoutExpired:
        code = 124
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
print((run / 'driver.log').read_text()[-3000:] if (run / 'driver.log').exists() else 'No driver log', flush=True)
(run / 'outcome.json').write_text(json.dumps({'exitCode': code}))
sys.exit(code)
