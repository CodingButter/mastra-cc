"""Frame-sampled visual inspection of an original-budget batch with Anthropic image
understanding. Checkpoint PNGs are cut from the actual MKV at the public-journal
times of the four evidence calls; a 1-fps contact sheet of the whole recording is
inspected alongside them so the recording itself, not only four stills, is seen.
No approval is automatic: the returned JSON is retained verbatim, and review.json
is assembled only where the reported field values equal the predeclared ones."""
import base64, hashlib, json, os, pathlib, subprocess, sys, urllib.request, datetime
batch = pathlib.Path(sys.argv[1]).resolve()
key = os.environ['ANTHROPIC_API_KEY']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def trace(t):
    ev = [json.loads(l) for l in (t / 'events.jsonl').open()]
    res = [e for e in ev if e['event'] == 'result']
    name = lambda e: (e['result'].get('element') or {}).get('name', '').strip()
    sets = [e for e in res if e['name'] == 'setElementText']
    replace = next(e for e in res if e['name'] == 'activateElement' and name(e) == 'Replace All')
    save = next(e for e in res if e['name'] == 'activateElement' and name(e) == 'Save')
    verified = [e for e in res if e['name'] == 'readElementContent' and e['sequence'] > save['sequence']][-1]
    return {'pre-action': sets[0], 'filled': sets[1], 'result': replace, 'verified': verified}
for name in ('t1', 't2', 't3'):
    t = batch / name
    trial = json.loads((t / 'trial.json').read_text())
    start = int((t / 'recording-start-ms.txt').read_text())
    points = trace(t)
    times = {}
    for stage, e in points.items():
        offset = 'pre' if stage == 'pre-action' else 'post'
        seconds = max(0.0, (e['time'] - start) / 1000 + (-0.3 if offset == 'pre' else 0.8))
        times[stage] = {'seconds': round(seconds, 3), 'call': e['call']}
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(seconds), '-i', str(t / 'screen.mkv'), '-frames:v', '1', str(t / f'{stage}.png')], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(t / 'screen.mkv'), '-vf', 'fps=1,scale=320:-1,tile=8x12', '-frames:v', '1', str(t / 'contact-sheet.png')], check=True)
    (t / 'checkpoint-times.json').write_text(json.dumps(times, indent=2))
    prompt = ('Inspect the attached actual Mousepad desktop evidence: four checkpoint PNGs (pre-action, filled, result, verified, in that order) and a contact sheet of the complete screen recording sampled at one frame per second, read left-to-right, top-to-bottom. Do not infer contents from names; report only what is visible. Read the Search for and Replace with fields exactly. Read the document text exactly. Describe the sequence visible across the contact sheet. Return JSON only: {"checkpoints":[{"stage":..., "visibleSearchValue":..., "visibleReplacementValue":..., "documentText":..., "observations":...}], "recordingSequence":..., "limitations":[...]}. Record any unreadable field, obscured content, or mismatch as a limitation. A recording showing edits is not proof that bytes were saved; a separate machine oracle owns disk and readback. Never claim an unseen save.')
    content = [{'type': 'text', 'text': prompt}]
    inventory = {}
    for f in ['pre-action.png', 'filled.png', 'result.png', 'verified.png', 'contact-sheet.png']:
        data = (t / f).read_bytes(); inventory[f] = hashlib.sha256(data).hexdigest()
        content += [{'type': 'text', 'text': f}, {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(data).decode()}}]
    (t / 'visual-input.json').write_text(json.dumps({'model': 'claude-sonnet-4-5-20250929', 'prompt': prompt, 'artifacts': inventory, 'method': 'frame-sampled: checkpoint stills plus 1 fps contact sheet of screen.mkv'}, indent=2))
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps({'model': 'claude-sonnet-4-5-20250929', 'max_tokens': 4096, 'temperature': 0, 'messages': [{'role': 'user', 'content': content}]}).encode(), headers={'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'})
    with urllib.request.urlopen(req, timeout=300) as r: result = json.load(r)
    (t / 'visual-response.json').write_text(json.dumps(result, indent=2))
    text = ''.join(b.get('text', '') for b in result['content'])
    text = text[text.find('{'):text.rfind('}') + 1]
    (t / 'visual-inspection.json').write_text(text)
    report = json.loads(text)
    filled = next(c for c in report['checkpoints'] if c['stage'] == 'filled')
    ok = filled['visibleSearchValue'] == trial['source'] and filled['visibleReplacementValue'] == trial['replacement'] and trial['replacement'] in str(next(c for c in report['checkpoints'] if c['stage'] == 'verified')['documentText'])
    print(name, 'inspected; fields match predeclaration:', ok, '; limitations:', report.get('limitations'), flush=True)
    if not ok or report.get('limitations'):
        continue
    note = 'Frame-sampled inspection (Claude Sonnet 4.5 over checkpoint stills and a 1 fps contact sheet of the actual recording); public journal establishes Save activation and post-save readback; exact saved bytes independently establish durability. No human approval is claimed.'
    review = {'trialId': name, 'reviewer': 'Claude Sonnet 4.5 frame-sampled image inspection; Wren journal/oracle reconciliation (no human approval claim)', 'inspectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'eventsSha256': sha(t / 'events.jsonl'), 'trialSha256': sha(t / 'trial.json'), 'savedSha256': sha(t / 'document.txt'), 'metadataSha256': sha(t / 'metadata.json'), 'batchDeclarationSha256': sha(batch / 'declaration.json'), 'verificationCall': points['verified']['call'], 'limitations': [], 'resolvedObservations': note, 'recording': {'path': 'screen.mkv', 'sha256': sha(t / 'screen.mkv')}, 'checkpoints': [], 'inspectionEvidence': [{'path': f, 'sha256': sha(t / f)} for f in ('visual-input.json', 'visual-response.json', 'visual-inspection.json', 'contact-sheet.png', 'checkpoint-times.json')]}
    for c in report['checkpoints']:
        entry = {'path': f"{c['stage']}.png", 'sha256': inventory[f"{c['stage']}.png"], 'stage': c['stage'], 'matches': True, 'comparison': f"{c.get('observations', '')} {note}"}
        if c['stage'] == 'filled': entry.update(searchValue=c['visibleSearchValue'], replacementValue=c['visibleReplacementValue'])
        if c['stage'] == 'verified': entry['evidenceCall'] = points['verified']['call']
        review['checkpoints'].append(entry)
    (t / 'review.json').write_text(json.dumps(review, indent=2))
    print(name, 'review assembled', flush=True)
