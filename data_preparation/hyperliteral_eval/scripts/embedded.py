import json,urllib.request,urllib.parse,time,os
UA="phrasis-gloss-gold/1.0 (language-learning eval dataset; contact ermler.paul@gmail.com)"
def embeddedin(tpl, limit=5000):
    out=[];cont=None
    while len(out)<limit:
        q={"action":"query","list":"embeddedin","eititle":tpl,"eilimit":"500",
           "einamespace":"0","format":"json","formatversion":"2"}
        if cont: q["eicontinue"]=cont
        url="https://en.wikipedia.org/w/api.php?"+urllib.parse.urlencode(q)
        for a in range(6):
            try:
                req=urllib.request.Request(url,headers={"User-Agent":UA})
                d=json.load(urllib.request.urlopen(req,timeout=60)); break
            except Exception as e:
                if a==5: raise
                time.sleep(3*(a+1))
        out+= [p["title"] for p in d["query"]["embeddedin"]]
        cont=d.get("continue",{}).get("eicontinue")
        if not cont: break
        time.sleep(1.0)
    return out
if __name__=="__main__":
    all_pages={}
    for t in ["Template:Interlinear","Template:Fs interlinear","Template:Gloss"]:
        try:
            ps=embeddedin(t); all_pages[t]=ps
            print(f"{t}: {len(ps)} pages")
        except Exception as e:
            print(f"{t}: FAILED {e}")
    merged=sorted({p for ps in all_pages.values() for p in ps})
    json.dump(merged,open("gloss_pages.json","w"))
    print("merged unique pages:",len(merged))
