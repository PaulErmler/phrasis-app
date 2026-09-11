import re,json
from collections import Counter
from fetchbatch import cached

def templates(w, names=("interlinear","fs interlinear")):
    """Yield the raw body of each {{name|...}} template, brace-matched."""
    pat=re.compile(r'\{\{\s*(' + "|".join(n.replace(" ",r"[ _]") for n in names) + r')\s*(?=[\|\}])', re.I)
    for m in pat.finditer(w):
        i=m.start(); depth=0; j=i
        while j < len(w):
            if w.startswith('{{',j): depth+=1; j+=2; continue
            if w.startswith('}}',j):
                depth-=1; j+=2
                if depth==0: break
                continue
            j+=1
        else: continue
        yield w[i:j]

def split_params(body):
    """Split a template body on top-level pipes."""
    inner=body[2:-2]
    parts=[];cur=[];depth=0;br=0
    k=0
    while k < len(inner):
        if inner.startswith('{{',k): depth+=1; cur.append(inner[k:k+2]); k+=2; continue
        if inner.startswith('}}',k): depth-=1; cur.append(inner[k:k+2]); k+=2; continue
        if inner.startswith('[[',k): br+=1; cur.append(inner[k:k+2]); k+=2; continue
        if inner.startswith(']]',k): br-=1; cur.append(inner[k:k+2]); k+=2; continue
        c=inner[k]
        if c=='|' and depth==0 and br==0:
            parts.append(''.join(cur)); cur=[]; k+=1; continue
        cur.append(c); k+=1
    parts.append(''.join(cur))
    return parts[0].strip(), parts[1:]

def parse_one(body):
    name, params = split_params(body)
    named={}; pos=[]
    for p in params:
        m=re.match(r'^\s*([A-Za-z][A-Za-z0-9_\-]*)\s*=(.*)$', p, re.S)
        if m: named[m.group(1).lower()]=m.group(2).strip()
        else: pos.append(p.strip())
    return name.lower(), named, pos
