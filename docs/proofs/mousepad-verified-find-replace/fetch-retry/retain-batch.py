import gzip, hashlib, json, pathlib, re, sys
source=pathlib.Path(sys.argv[1]).resolve();target=pathlib.Path(sys.argv[2]);target.mkdir(parents=True,exist_ok=True);records=[]
files=[p for p in source.iterdir() if p.is_file()]
for id in ('t1','t2','t3'):files.extend(p for p in (source/id).iterdir() if p.is_file())
files.extend(source/'installed'/p for p in ('consumer-lock.json','installed-imports.json') if (source/'installed'/p).is_file())
files.extend(source/'installed'/'consumer'/p for p in ('model-driver.mjs','model-rate.mjs'))
for p in sorted(files):
 data=p.read_bytes();assert not re.search(rb'sk-ant-api03-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}',data),'credential pattern in '+str(p)
 rel=p.relative_to(source);dest=target/(str(rel)+'.gz');dest.parent.mkdir(parents=True,exist_ok=True);compressed=gzip.compress(data,mtime=0);dest.write_bytes(compressed);assert gzip.decompress(dest.read_bytes())==data
 records.append({'source':str(rel),'retained':str(dest.relative_to(target)),'sha256':hashlib.sha256(data).hexdigest(),'retainedSha256':hashlib.sha256(compressed).hexdigest(),'bytes':len(data)})
(target/'inventory.json').write_text(json.dumps({'source':str(source),'exclusions':['installed dependency tree','trial home/runtime directories'],'artifacts':records},indent=2))
for r in records:
 data=(target/r['retained']).read_bytes();assert hashlib.sha256(data).hexdigest()==r['retainedSha256'];assert hashlib.sha256(gzip.decompress(data)).hexdigest()==r['sha256']
print(f'GREEN: {len(records)} artifacts independently hash-verified; credential-pattern scan clear')
