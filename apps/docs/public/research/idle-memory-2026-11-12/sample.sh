#!/usr/bin/env bash
# usage: sample.sh <project> <samples> <interval> <outfile>
proj=$1; n=$2; iv=$3; out=$4
echo "ts,container,mem_bytes,cpu_pct" > "$out"
for i in $(seq 1 "$n"); do
  ts=$(date -u +%FT%TZ)
  docker stats --no-stream --format '{{.Name}},{{.MemUsage}},{{.CPUPerc}}' $(docker ps -q --filter "label=com.docker.compose.project=$proj") 2>/dev/null |
  python3 -c "
import sys,re
u={'B':1,'KiB':1024,'MiB':1024**2,'GiB':1024**3}
for l in sys.stdin:
    name,mem,cpu=l.strip().split(',')
    v,unit=re.match(r'([\d.]+)(\w+)',mem.split('/')[0].strip()).groups()
    print('$ts,%s,%d,%s'%(name,float(v)*u[unit],cpu.strip('%')))
" >> "$out"
  sleep "$iv"
done
