import csv,collections,statistics as st,sys
rows=list(csv.DictReader(open(sys.argv[1])))
by=collections.defaultdict(list)
for r in rows: by[r['container']].append((r['ts'],int(r['mem_bytes']),float(r['cpu_pct'])))
MiB=1024**2
k=next(iter(by)); n=len(by[k]); print('samples',n,by[k][0][0],'->',by[k][-1][0])
print('%-24s %8s %8s %8s %8s %8s'%('container','first','last','min','max','cpu_avg%'))
for c,v in sorted(by.items(),key=lambda kv:-kv[1][-1][1]):
    m=[x[1] for x in v]; cpu=[x[2] for x in v]
    print('%-24s %8.1f %8.1f %8.1f %8.1f %8.2f'%(c,m[0]/MiB,m[-1]/MiB,min(m)/MiB,max(m)/MiB,st.mean(cpu)))
ts=sorted({r['ts'] for r in rows})
tot=[sum(int(r['mem_bytes']) for r in rows if r['ts']==t)/MiB for t in ts]
print('stack total MiB first %.0f last %.0f min %.0f max %.0f'%(tot[0],tot[-1],min(tot),max(tot)))
