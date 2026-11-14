#!/usr/bin/env python3
"""Create versioned packs and a digest-pinned catalogue from the measured audit."""
import argparse,hashlib,json
from pathlib import Path
from prepare_pack import prepare

ROOT=Path(__file__).resolve().parents[2]
BASE='https://raw.githubusercontent.com/randspy/langocard/content-v2/content/'
SOURCE=('French Wiktionary contributors via Kaikki/Wiktextract, dump 2026-10-01, extraction 2026-10-30; '
        'https://kaikki.org/dictionary/rawdata.html; per-entry French Wiktionary URLs. '
        'Frequency: Lexique 3.83, Boris New, Christophe Pallier and contributors, '
        'https://openlexicon.fr/datasets-info/Lexique383/README-Lexique.html. '
        'Adaptations: filtered definitions and examples, English sense alignment, noun articles, cloze markup, frequency ranks.')
LICENSE='CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/; see NOTICE.md for attribution and modifications'


def publish(audit,out):
    out.mkdir(parents=True,exist_ok=True)
    pilot=prepare(ROOT/'apps/android/app/src/main/assets/pilot.tsv','Original pilot','Personal draft')['entries']
    excluded={e['word'].removeprefix('un ').removeprefix('une ') for e in pilot}
    rows=[json.loads(line) for line in (audit/'candidates.jsonl').read_text().splitlines()]
    # Known source-quality failures found during the sample audit are not shipped.
    rejected={'frw-2a17fcda27685276aed5','frw-70b85ca43846827de58d','frw-9bb19acfa42c9a277599','frw-4dabba405a41606d260e'}
    rows=[e for e in rows if e['lemma'] not in excluded and e['id'] not in rejected]
    bands=[(1,2500,'frequent','Frequent French'),(2501,7000,'everyday','Everyday expansion'),(7001,20000,'extended','Beyond the everyday')]
    manifest=[]
    for low,high,key,title in bands:
        entries=[e for e in rows if low<=e['rank']<=high]
        if not entries:continue
        pack_id='fr-source-'+key+'-2026-11-v1'
        pack=dict(format='langocard-pack',version=2,packId=pack_id,packVersion=2,source=SOURCE,license=LICENSE,
                  status='source-aligned; not independently language-reviewed',entries=entries)
        payload=(json.dumps(pack,ensure_ascii=False,indent=2)+'\n').encode()
        assert len(payload)<20*1024*1024
        filename=pack_id+'.json';(out/filename).write_bytes(payload)
        manifest.append(dict(id=pack_id,title=title,description=f'Selected meanings from frequency ranks {low:,}–{high:,}.',
                             meanings=len(entries),lemmas=len({e['lemma'] for e in entries}),url=BASE+filename,sha256=hashlib.sha256(payload).hexdigest()))
    catalogue=dict(format='langocard-catalogue',version=1,packs=manifest)
    (out/'catalogue.json').write_text(json.dumps(catalogue,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'apps/android/app/src/main/assets/catalogue.json').write_text(json.dumps(catalogue,ensure_ascii=False,indent=2)+'\n')
    report=json.loads((audit/'audit.json').read_text())
    report['published_senses']=len(rows);report['published_lemmas']=len({e['lemma'] for e in rows})
    report['excluded_pilot_lemmas']=len(excluded);report['known_sample_rejections']=sorted(rejected)
    (ROOT/'apps/android/app/src/main/assets/frequent-pack.json').write_bytes((out/(manifest[0]['id']+'.json')).read_bytes())
    (ROOT/'apps/android/app/src/main/assets/CONTENT-NOTICE.md').write_bytes((out/'NOTICE.md').read_bytes())
    (out/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    # The ranked reference list measures coverage; it is not counted as study cards.
    reference=json.loads((audit/'ranked-lemmas.json').read_text())
    (out/'ranked-lemmas.json').write_text('[\n'+',\n'.join(json.dumps(row,ensure_ascii=False,separators=(',',':')) for row in reference)+'\n]\n')
    print(json.dumps(manifest,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--audit',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'content')
    a=p.parse_args();publish(a.audit,a.output)
