# Moved declarations are the original lines, in order: strip import statements
# and a leading "export " from both sides, then compare line sequences.
# usage: python3 same-code.py <original server.ts> <repo-root>
import re,sys,glob
def norm(t):
    t=re.sub(r'^import[\s\S]*?;\n','',t,flags=re.M)
    return [re.sub(r'^export (?=(async )?(function|const|let|class|interface|type)\s)','',l) for l in t.split('\n') if l.strip() and not l.startswith('export * from')]
orig=norm(open(sys.argv[1]).read())
root=sys.argv[2]+'/daemon/src/'
new=norm(open(root+'server.ts').read())
for m in ['grants','launch-focus','subscriptions','dispatch','queues','pipes']: new+=norm(open(root+f'server/{m}.ts').read())
print(f'original lines {len(orig)}, moved lines {len(new)}')
print('same multiset of lines:', sorted(orig)==sorted(new))
extra=set(new)-set(orig); lost=set(orig)-set(new)
print('lines only in branch:',len(extra),' lines only in base:',len(lost))
