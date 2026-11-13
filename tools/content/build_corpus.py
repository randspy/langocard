#!/usr/bin/env python3
"""Build source-aligned study candidates; never invent missing translations/examples."""
import argparse,csv,gzip,hashlib,io,json,re,zipfile,unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import quote

BAD={'obsolete','archaic','dated','rare','offensive','vulgar','derogatory','slur','form-of','plural','Canada','Quebec'}
POS={'noun':'NOM','verb':'VER','adj':'ADJ','adv':'ADV','prep':'PRE','conj':'CON','pron':'PRO'}

def ranked_lemmas(path,limit):
    words={}
    finite=set()
    with zipfile.ZipFile(path) as z:
        for r in csv.DictReader(io.TextIOWrapper(z.open('Lexique383.tsv'),encoding='utf-8-sig'),delimiter='\t'):
            if r['cgram'] in ('VER','AUX') and re.search(r'(ind|sub|cnd|imp):',r['infover']):finite.add(r['ortho'])
            word=r['lemme']
            if not re.fullmatch(r"[a-zàâäéèêëïîôöùûüÿçœæ'’ -]+",word):continue
            o=words.setdefault(word,{'lemma':word,'film':0.,'book':0.,'genders':set(),'pos':set()})
            o['film']=max(o['film'],float(r['freqlemfilms2']))
            o['book']=max(o['book'],float(r['freqlemlivres']))
            if r['ortho']==word:
                o['pos'].add(r['cgram'])
                if r['cgram']=='NOM' and r['genre'] in ('m','f'):o['genders'].add(r['genre'])
    for channel in ['film','book']:
        for rank,o in enumerate(sorted(words.values(),key=lambda o:(-o[channel],o['lemma'])),1):o[channel+'_rank']=rank
    ordered=sorted(words.values(),key=lambda o:(.7*o['film_rank']+.3*o['book_rank'],o['lemma']))[:limit]
    for rank,o in enumerate(ordered,1):o['rank']=rank;o['genders']=sorted(o['genders']);o['pos']=sorted(o['pos'])
    return {o['lemma']:o for o in ordered},finite

def normalized(text):
    text=re.sub(r'^\([^)]*\)\s*','',text)
    return ' '.join(re.findall(r'[a-z0-9]+',unicodedata.normalize('NFKD',text.lower()).encode('ascii','ignore').decode()))

def candidates(record,lemma,finite):
    word=record['word'];pos=record.get('pos')
    if pos not in POS or POS[pos] not in lemma['pos']:return
    if BAD.intersection(record.get('tags',[])):return
    senses=record.get('senses',[])
    # Nested definitions have numbering that cannot safely be treated as a flat ordinal.
    if any(len(s.get('glosses',[]))!=1 for s in senses):return
    aligned={}
    for translation in record.get('translations',[]):
        if translation.get('lang_code')!='en' or BAD.intersection(translation.get('tags',[])):continue
        label=normalized(translation.get('sense',''))
        if len(label)<12:continue
        matches=[i for i,s in enumerate(senses,1) if
                 (normalized(s['glosses'][0]).startswith(label) or label.startswith(normalized(s['glosses'][0])))
                 and len(normalized(s['glosses'][0]))>=12]
        if len(matches)==1:aligned.setdefault(matches[0],[]).append(translation)
    for index,sense in enumerate(senses,1):
        if sense.get('form_of') or sense.get('alt_of') or BAD.intersection(sense.get('tags',[])):continue
        definition=sense['glosses'][0]
        if not 8<=len(definition)<=240 or any(x in definition for x in ['{','}','http','→']):continue
        translations=[]
        for t in aligned.get(index,[]):
            if not BAD.intersection(t.get('tags',[])):
                english=t.get('word','')
                if english and len(english)<70 and english not in translations:translations.append(english)
        if not translations:continue
        display=word
        if pos=='noun':
            if len(lemma['genders'])!=1:continue
            display=('un ' if lemma['genders']==['m'] else 'une ')+word
        examples=[]
        for example in sense.get('examples',[]):
            text=example.get('text','')
            if example.get('ref') or example.get('translation') or not 25<=len(text)<=180:continue
            if not text.endswith(('.', '!', '?')) or ' - ' in text or '…' in text:continue
            if not set(re.findall(r'[^\W\d_]+',text.lower())).intersection(finite):continue
            if any(x in text for x in ['{','}','http','[…]','\n']):continue
            target=re.escape(word)
            if pos=='noun':
                article=r'(?:un|le)' if lemma['genders']==['m'] else r'(?:une|la)'
                target=article+r'\s+'+target
            matches=list(re.finditer(r'(?<![\w’\'])'+target+r'(?![\w’\'])',text,re.I))
            if len(matches)!=1:continue
            m=matches[0];marked=text[:m.start()]+'{'+m.group()+'}'+text[m.end():]
            examples.append(marked)
        if not examples:continue
        stable=hashlib.sha256((word+'\0'+pos+'\0'+definition).encode()).hexdigest()[:20]
        yield dict(id='frw-'+stable,word=display,english='; '.join(translations[:3]),definition=definition,
                   example=min(examples,key=len),topic='daily',lemma=word,rank=lemma['rank'],
                   sourceUrl='https://fr.wiktionary.org/wiki/'+quote(word,safe='')+'#fr',
                   license='CC BY-SA 4.0',sourceSense=index,sourcePos=pos,
                   gender=({'m':'masculine','f':'feminine'}[lemma['genders'][0]] if pos=='noun' else None))

def build(lexique,dictionary,output,limit=20000):
    lock=json.loads((Path(__file__).resolve().parents[2]/'content/sources.lock.json').read_text())
    for role,path in [('lexique',lexique),('dictionary',dictionary)]:
        with path.open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
        if actual!=lock[role]['sha256']:raise ValueError(f'{role} snapshot differs from sources.lock.json; audit and pin the new source before rebuilding')
    output.mkdir(parents=True,exist_ok=True)
    ranked,finite=ranked_lemmas(lexique,limit)
    entries={};seen=set();stats=Counter()
    with gzip.open(dictionary,'rt') as stream:
        for line in stream:
            record=json.loads(line)
            if record.get('lang_code')!='fr' or record.get('word') not in ranked:continue
            seen.add(record['word']);stats['matching_records']+=1
            for entry in candidates(record,ranked[record['word']],finite):entries[entry['id']]=entry
    ordered=sorted(entries.values(),key=lambda e:(e['rank'],e['sourceSense'],e['id']))
    report=dict(ranked_lemmas=len(ranked),dictionary_lemmas=len(seen),study_lemmas=len({e['lemma'] for e in ordered}),study_senses=len(ordered),
        source_sha256={str(p.name):hashlib.file_digest(p.open('rb'),'sha256').hexdigest() for p in [lexique,dictionary]},
        selection='70% subtitle rank + 30% book rank; unique same-edition translation-label/definition prefix match (numbering alone is NOT trusted), unnested definitions, unreferenced short examples containing a possible finite-verb form, exact lemma match; noun gender from Lexique',
        status='Source-aligned and structurally checked, not independently language-reviewed. Excluded words are not marked learned or fabricated.')
    (output/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (output/'ranked-lemmas.json').write_text(json.dumps(list(ranked.values()),ensure_ascii=False,indent=2)+'\n')
    (output/'candidates.jsonl').write_text(''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in ordered))
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--lexique',type=Path,required=True);p.add_argument('--dictionary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--limit',type=int,default=20000)
    a=p.parse_args();build(a.lexique,a.dictionary,a.output,a.limit)
