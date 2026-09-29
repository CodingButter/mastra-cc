import json
import os
import struct
import subprocess
import sys
import time

helper = '/usr/local/libexec/mastra-cc-kwin-capture'

def gone(pid):
    assert not os.path.exists('/proc/%d/fd' % pid), 'helper descriptors remain'
    for entry in os.scandir('/proc'):
        if entry.name.isdigit():
            try:
                assert os.getpgid(int(entry.name)) != pid, 'residual helper process group'
            except ProcessLookupError:
                pass

mode = sys.argv[1]
assert mode in ('denied', 'authorized', 'cleanup')
if mode == 'cleanup':
    import select
    for scenario in ('cancel', 'deadline', 'closed-reader'):
        started = time.monotonic()
        proc = subprocess.Popen([helper], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            assert select.select([proc.stdout], [], [], 5)[0], 'no frame prefix'
            assert proc.stdout.read(4), 'helper failed before output: ' + proc.stderr.read().decode()
            if scenario == 'cancel':
                proc.terminate()
            elif scenario == 'closed-reader':
                proc.stdout.close()
            # Leave stdout undrained: exercise the actual installed output deadline.
            proc.wait(timeout=11)
            assert proc.returncode != 0
            elapsed = time.monotonic() - started
            assert elapsed < 11
            if scenario == 'deadline':
                assert elapsed >= 9
            gone(proc.pid)
            print('LIFECYCLE:', scenario, 'exit', proc.returncode, 'seconds', round(elapsed, 3), 'process/FDs gone')
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=2)
            proc.stdout.close()
            proc.stderr.close()
    mode = 'authorized'
end = time.monotonic() + 20
while True:
    started = time.monotonic()
    with subprocess.Popen([helper], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True) as child:
        try:
            stdout, stderr = child.communicate(timeout=11)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate()
            raise
        result = subprocess.CompletedProcess([helper], child.returncode, stdout, stderr)
        gone(child.pid)
    assert time.monotonic() - started < 11
    if mode == 'denied':
        if result.returncode != 0 and b'NoAuthorized' in result.stderr:
            assert not result.stdout
            print('DENIED: NoAuthorized; zero bytes; fresh process exited')
            break
        assert result.returncode == 0, result.stderr.decode()
    else:
        if result.returncode == 0:
            frame = result.stdout
            assert 4 < len(frame) <= 4096 + 4 + 16 * 1024 * 1024
            length, = struct.unpack('>I', frame[:4])
            assert 0 < length <= 4096
            header = json.loads(frame[4:4+length])
            assert header['version'] == 1 and header['format'] == 'RGB'
            assert header['x'] == header['y'] == 0 and header['scale'] == 1
            assert header['stride'] == header['width'] * 3
            assert header['bytes'] == header['stride'] * header['height'] == len(frame)-4-length
            layout = header['layout']
            assert layout['outputs'] == 1 and layout['scale'] == 1
            assert layout['width'] == header['width'] and layout['height'] == header['height']
            assert layout['x'] == layout['y'] == 0
            info = subprocess.check_output(['qdbus6','org.kde.KWin','/KWin','supportInformation'], timeout=5).decode()
            assert 'Number of Screens: 1\n' in info
            assert 'Geometry: 0,0,%dx%d\n' % (header['width'],header['height']) in info
            assert 'Scale: 1\n' in info and 'Compositing Type: OpenGL' in info
            print('FRAME:', json.dumps(header, sort_keys=True), 'exact bytes verified; compositor agrees')
            break
        assert b'NoAuthorized' in result.stderr, result.stderr.decode()
    if time.monotonic() >= end:
        raise RuntimeError('authorization cache did not converge')
    time.sleep(0.1)
for entry in os.scandir('/proc'):
    if entry.name.isdigit():
        try:
            assert os.readlink(entry.path + '/exe') != helper, 'residual helper process'
        except (FileNotFoundError, PermissionError):
            pass
print('CLEANUP: no residual helper process or its FDs')
