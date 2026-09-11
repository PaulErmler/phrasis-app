import json,urllib.request,urllib.parse,time,sys
BASE="https://datasets-server.huggingface.co/filter"
def q(lang, limit=100, offset=0, tries=8):
    p={"dataset":"lecslab/glosslm-corpus","config":"default","split":"train",
       "where":f"\"language\"='{lang}'","limit":str(limit),"offset":str(offset)}
    url=BASE+"?"+urllib.parse.urlencode(p)
    for a in range(tries):
        try:
            r=urllib.request.urlopen(urllib.request.Request(url,
                headers={"User-Agent":"phrasis-gloss-gold/1.0"}),timeout=120)
            d=json.load(r)
            if "error" in d:
                time.sleep(12); continue
            return d
        except Exception as e:
            time.sleep(8)
    return None
if __name__=="__main__":
    for L in sys.argv[1:]:
        d=q(L,limit=5)
        if d is None: print(f"{L}: no answer"); continue
        print(f"\n=== {L}: total {d.get('num_rows_total')}")
        for r in d.get("rows",[])[:4]:
            row=r["row"]
            print("  T:",repr(row.get("transcription"))[:95])
            print("  G:",repr(row.get("glosses"))[:95])
            print("  X:",repr(row.get("translation"))[:70],"seg:",row.get("is_segmented"),"meta:",row.get("metalang"))
