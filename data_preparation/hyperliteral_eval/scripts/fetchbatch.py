import json,urllib.request,urllib.parse,time,os,hashlib,sys
UA="phrasis-gloss-gold/1.0 (language-learning eval dataset; contact ermler.paul@gmail.com)"
CACHE=os.path.join(os.path.dirname(os.path.abspath(__file__)),"wtbatch"); os.makedirs(CACHE,exist_ok=True)
def _path(title): return os.path.join(CACHE,hashlib.sha1(title.encode()).hexdigest()[:16]+".txt")
def cached(title):
    p=_path(title)
    return open(p,encoding="utf-8").read() if os.path.exists(p) else None
def fetch_batch(titles):
    q={"action":"query","prop":"revisions","rvprop":"content","rvslots":"main",
       "titles":"|".join(titles),"format":"json","formatversion":"2","redirects":"1"}
    data=urllib.parse.urlencode(q).encode()
    for a in range(6):
        try:
            req=urllib.request.Request("https://en.wikipedia.org/w/api.php",data=data,
                                       headers={"User-Agent":UA})
            return json.load(urllib.request.urlopen(req,timeout=90))
        except Exception as e:
            if a==5: raise
            time.sleep(4*(a+1))
def fetch_all(titles):
    todo=[t for t in titles if cached(t) is None]
    print(f"{len(titles)} titles, {len(todo)} to fetch",flush=True)
    for i in range(0,len(todo),50):
        chunk=todo[i:i+50]
        d=fetch_batch(chunk)
        got={}
        norm={}
        for n in d.get("query",{}).get("normalized",[]): norm[n["to"]]=n["from"]
        for r in d.get("query",{}).get("redirects",[]): norm[r["to"]]=norm.get(r["from"],r["from"])
        for p in d.get("query",{}).get("pages",[]):
            t=p.get("title")
            try: txt=p["revisions"][0]["slots"]["main"]["content"]
            except Exception: txt=""
            got[t]=txt
            src=norm.get(t)
            if src: got[src]=txt
        for t in chunk:
            open(_path(t),"w",encoding="utf-8").write(got.get(t,""))
        print(f"  {i+len(chunk)}/{len(todo)}",flush=True)
        time.sleep(1.0)
