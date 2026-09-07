import base64, hashlib, json, os, pathlib, sys, urllib.request, urllib.error
batch=pathlib.Path(sys.argv[1])
key=os.environ.get('GOOGLE_API_KEY') or os.environ['GEMINI_API_KEY']
for name in ('t1','t2','t3'):
 p=batch/name
 prompt='Inspect the attached actual Mousepad desktop video and four PNG checkpoints. Do not infer image contents from filenames or assume success. Read the visible Search for and Replace with fields exactly, including suffixes. Read the final document text exactly. Explain the sequence visible in the video, with timestamps: opening replace dialog, identifying both fields, entering values, activating replacement, resulting document, saving, final visible document. Checkpoint stages are pre-action, filled, result, verified. Return JSON with videoInspected, timeline, checkpoints (stage, visibleSearchValue, visibleReplacementValue, documentText, observations), limitations. Record any ambiguity, obscured content, unreadable field, mismatch, or inability to inspect video as a limitation. A video showing correct edits is not independently proof that bytes were saved; a separate machine oracle handles disk/readback. Never claim an unseen save or readback.'
 parts=[{'text':prompt}];inventory={}
 for file,mime in [('screen.mp4','video/mp4')]+[(stage+'.png','image/png') for stage in ('pre-action','filled','result','verified')]:
  data=(p/file).read_bytes();inventory[file]=hashlib.sha256(data).hexdigest();parts.extend([{'text':file},{'inlineData':{'mimeType':mime,'data':base64.b64encode(data).decode()}}])
 (p/'visual-input.json').write_text(json.dumps({'model':'gemini-2.5-flash','prompt':prompt,'artifacts':inventory},indent=2))
 request=urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',data=json.dumps({'contents':[{'role':'user','parts':parts}],'generationConfig':{'temperature':0,'responseMimeType':'application/json','maxOutputTokens':8192}}).encode(),headers={'Content-Type':'application/json','x-goog-api-key':key})
 try:
  with urllib.request.urlopen(request,timeout=180) as response:result=json.load(response)
 except urllib.error.HTTPError as error:
  (p/'visual-error.json').write_bytes(error.read());print(name,'visual HTTP error',error.code,flush=True);continue
 (p/'visual-response.json').write_text(json.dumps(result,indent=2));text=''.join(x.get('text','') for x in result.get('candidates',[{}])[0].get('content',{}).get('parts',[]));(p/'visual-inspection.json').write_text(text);print(name,'visual response retained',flush=True)
