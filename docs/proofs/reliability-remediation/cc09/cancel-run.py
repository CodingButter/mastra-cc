import pathlib, tempfile, os, json, shutil, subprocess, hashlib, sys, signal

# The session script resolves the daemon from its own location; a shadow root
# points it at THIS worktree's freshly built daemon so the measurement runs
# the cancellation seam under test, not another branch's daemon.
session, modules = map(lambda value: pathlib.Path(value).resolve(), sys.argv[1:3])
here = pathlib.Path(__file__).resolve()
worktree = here.parents[4]
root = pathlib.Path(tempfile.mkdtemp(prefix='cc09-cancel.'))
shadow = root / 'shadow' / 'docs' / 'proofs' / 'session'
shadow.mkdir(parents=True)
shutil.copyfile(session, shadow / 'model-session.sh')
os.symlink(worktree / 'daemon', root / 'shadow' / 'daemon')
consumer = root / 'consumer'
consumer.mkdir()
os.symlink(modules, consumer / 'node_modules')
driver = here.with_name('cancel-driver.mjs')
shutil.copyfile(driver, consumer / 'model-driver.mjs')
run = root / 'trial'
run.mkdir()
(run / 'before.txt').write_text('Cancellation baseline\n')
(root / 'declaration.json').write_text(json.dumps({
    'session': str(session), 'modules': str(modules), 'daemon': str(worktree / 'daemon' / 'dist' / 'main.mjs'),
    'daemonSha256': hashlib.sha256((worktree / 'daemon' / 'dist' / 'main.mjs').read_bytes()).hexdigest(),
    'driverSha256': hashlib.sha256(driver.read_bytes()).hexdigest(),
    'sessionSha256': hashlib.sha256(session.read_bytes()).hexdigest(),
    'sampleCount': 5, 'closeAfterMs': 120,
    'claim': 'driver close is the cancellation request; acknowledgement = successor admission and daemon settle line; emitted keys are not retracted',
}, indent=2))
print('CANCEL:', root, flush=True)
with (run / 'session.txt').open('w') as log:
    proc = subprocess.Popen(['bash', str(shadow / 'model-session.sh'), '--display', str(run), str(consumer)],
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
