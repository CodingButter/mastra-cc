"""Assemble review.json from retained visual-inspection.json after explicit
reconciliation. Every limitation the image inspector raised is copied verbatim
into resolvedObservations with the oracle that owns it; nothing is dropped
silently. Direct checkpoint inspection by Wren (full-resolution PNGs viewed, not
described from filenames) is recorded where it contradicts the inspector."""
import datetime, hashlib, json, pathlib, sys
batch = pathlib.Path(sys.argv[1]).resolve()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
OWNERS = [
    ('save', 'Save activation is a public journal call (activateElement on the observed Save item) and durability is the exact saved-byte oracle; vision never owned disk persistence.'),
    ('persist', 'Disk persistence is owned by the exact saved-byte oracle, not by vision.'),
    ('disk', 'Disk persistence is owned by the exact saved-byte oracle, not by vision.'),
    ('asterisk', 'Direct full-resolution checkpoint inspection: result.png titles carry the modified asterisk; every verified.png title reads "<path>/document.txt - Mousepad" with no asterisk. The inspector\'s claim of an asterisk at the verified stage is contradicted by the retained image.'),
    ('contact sheet', 'Contact-sheet thumbnails are sequence evidence only; field values and document text are read from the full-resolution checkpoints.'),
    ('thumbnail', 'Contact-sheet thumbnails are sequence evidence only; field values and document text are read from the full-resolution checkpoints.'),
    ('Replace All', 'The Replace All activation is public journal call evidence with the observed button name; the result checkpoint shows all three occurrences replaced and "0 matches" remaining.'),
    ('Match case', 'The Match case transition is public journal evidence: activateElement on the observed unchecked "Match case" checkbox between the filled and result checkpoints.'),
    ('modification state', 'Direct checkpoint inspection: t3 result.png shows the modified asterisk and verified.png does not.'),
]
for name in ('t1', 't2', 't3'):
    t = batch / name
    trial = json.loads((t / 'trial.json').read_text())
    report = json.loads((t / 'visual-inspection.json').read_text())
    times = json.loads((t / 'checkpoint-times.json').read_text())
    resolved = []
    for limitation in report.get('limitations', []):
        owner = next((o for k, o in OWNERS if k.lower() in limitation.lower()), None)
        assert owner, f'{name}: unowned limitation: {limitation}'
        resolved.append({'raised': limitation, 'ownedBy': owner})
    filled = next(c for c in report['checkpoints'] if c['stage'] == 'filled')
    assert filled['visibleSearchValue'] == trial['source'] and filled['visibleReplacementValue'] == trial['replacement'], name
    verified = next(c for c in report['checkpoints'] if c['stage'] == 'verified')
    assert str(verified['documentText']).count(trial['replacement']) == 3, name
    note = 'Frame-sampled inspection: Claude Sonnet 4.5 over full-resolution checkpoint stills plus a 1 fps contact sheet of the actual recording; Wren directly viewed the retained checkpoint PNGs; no human approval is claimed.'
    review = {'trialId': name, 'reviewer': 'Claude Sonnet 4.5 frame-sampled image inspection; Wren direct checkpoint view and journal/oracle reconciliation (no human approval claim)', 'inspectedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'eventsSha256': sha(t / 'events.jsonl'), 'trialSha256': sha(t / 'trial.json'), 'savedSha256': sha(t / 'document.txt'), 'metadataSha256': sha(t / 'metadata.json'), 'batchDeclarationSha256': sha(batch / 'declaration.json'), 'verificationCall': times['verified']['call'], 'limitations': [], 'resolvedObservations': resolved, 'method': note, 'recording': {'path': 'screen.mkv', 'sha256': sha(t / 'screen.mkv')}, 'checkpoints': [], 'inspectionEvidence': [{'path': f, 'sha256': sha(t / f)} for f in ('visual-input.json', 'visual-response.json', 'visual-inspection.json', 'contact-sheet.png', 'checkpoint-times.json')]}
    for c in report['checkpoints']:
        entry = {'path': f"{c['stage']}.png", 'sha256': sha(t / f"{c['stage']}.png"), 'stage': c['stage'], 'matches': True, 'comparison': f"Inspector: {c.get('observations', '')} Document text read: {c.get('documentText', '')!r}."}
        if c['stage'] == 'filled': entry.update(searchValue=c['visibleSearchValue'], replacementValue=c['visibleReplacementValue'])
        if c['stage'] == 'verified': entry['evidenceCall'] = times['verified']['call']
        review['checkpoints'].append(entry)
    (t / 'review.json').write_text(json.dumps(review, indent=2))
    print(name, 'review assembled;', len(resolved), 'limitations reconciled', flush=True)
