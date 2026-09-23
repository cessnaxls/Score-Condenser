import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;
import JSZip from 'jszip';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import PDFDocument from 'pdfkit';

const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
app.use(express.json({limit:'60mb'})); app.use(express.static('public'));
app.get('/health',(_,r)=>r.json({ok:true}));
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
const stepSemi={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function xmlTagText(block,tag){
 const m=String(block||'').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));
 return m?String(m[1]).replace(/<[^>]+>/g,'').trim():'';
}
function xmlAttr(attrs,name){const m=String(attrs||'').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'));return m?m[1]:'';}
function stripXmlDoctype(raw=''){
 // MusicXML commonly carries a PUBLIC/DTD declaration. We never need DTD entity
 // expansion for score import, and disabling it also prevents entity-expansion limits
 // from being tripped by OMR/source text containing many escaped entities.
 return String(raw).replace(/<!DOCTYPE[^[]*(?:\[[\s\S]*?\]\s*)?>/gi,'');
}
function decodeBasicXmlText(v=''){
 return String(v).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function safeXmlParse(raw,extra={}){
 return new XMLParser({
  ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,preserveOrder:false,
  // Critical for large OMR scores: do not expand entities. MusicXML structural parsing
  // does not require it, and this avoids fast-xml-parser's expansion-count guard.
  processEntities:false,removeNSPrefix:true,
  ...extra
 }).parse(stripXmlDoctype(raw));
}
function parseXML(buf){
 const raw=buf.toString();
 const x=safeXmlParse(raw);
 const score=x['score-partwise']; if(!score) throw Error('This app expects a MusicXML score-partwise document.');
 const names={}; for(const p of arr(score['part-list']?.['score-part'])) { const pn=p['part-name']; names[p['@_id']]=typeof pn==='object'?String(pn?.['#text']||pn?.['display-text']||p['@_id']):String(pn||p['@_id']); }
 const credits=arr(score.credit).flatMap(c=>arr(c?.['credit-words']).map(w=>typeof w==='object'?String(w['#text']||''):String(w))).map(v=>v.trim()).filter(Boolean);
 const creators=arr(score.identification?.creator);
 const composerNode=creators.find(c=>typeof c==='object'&&String(c['@_type']||'').toLowerCase()==='composer')||creators[0];
 const composer=typeof composerNode==='object'?String(composerNode?.['#text']||''):String(composerNode||'');
 const title=decodeBasicXmlText(score.work?.['work-title']||score['movement-title']||credits[0]||'').trim();
 const movement=decodeBasicXmlText(score['movement-title']||'').trim();
 const descriptiveCredit=credits.find(c=>c!==title && c!==composer && !/^\[?an[oó]nimo\]?$/i.test(c))||'';
 const subtitle=movement || descriptiveCredit;
 const rights=arr(score.identification?.rights).map(r=>typeof r==='object'?r['#text']:r).filter(Boolean).join(' · ');
 const source=decodeBasicXmlText(score.identification?.source||'').trim();
 const dateMatch=(composer.match(/(?:c\.?\s*)?\d{3,4}\s*[–—-]\s*(?:c\.?\s*)?\d{2,4}/)||[])[0]||'';
 const cleanComposer=dateMatch?composer.replace(dateMatch,'').replace(/[(),;\s]+$/,'').trim():composer;

 // IMPORTANT: MusicXML cursor position depends on document order. The old importer iterated
 // only m.note and therefore ignored <backup>/<forward>, which made independent voices pile up
 // at incorrect horizontal positions after OMR. Read each measure's note/backup/forward stream
 // in source order instead. This applies equally to imported MusicXML and OMR output.
 const rawPartMap=new Map();
 for(const pm of raw.matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/gi)){
  const id=xmlAttr(pm[1],'id'); if(id)rawPartMap.set(id,pm[2]);
 }
 const parts=[]; let globalMeasures=0;
 for(const p of arr(score.part)){
  const partId=String(p['@_id']);
  const partRaw=rawPartMap.get(partId)||'';
  const measureBlocks=[...partRaw.matchAll(/<measure\b([^>]*)>([\s\S]*?)<\/measure>/gi)].map(m=>({attrs:m[1],body:m[2]}));
  const voices=new Set(), events=[], measureMeta=[]; let divisions=1, beats=4, beatType=4, fifths=0, mi=0;
  const fallbackMeasures=arr(p.measure);
  const count=Math.max(measureBlocks.length,fallbackMeasures.length);
  for(let idx=0;idx<count;idx++){
   const mb=measureBlocks[idx]?.body||'';
   const fm=fallbackMeasures[idx]||{};
   const divText=xmlTagText(mb,'divisions'); if(divText)divisions=Number(divText)||divisions; else if(fm.attributes?.divisions)divisions=Number(fm.attributes.divisions)||divisions;
   const timeBlock=(mb.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)||[])[1]||'';
   const bt=xmlTagText(timeBlock,'beats'), btt=xmlTagText(timeBlock,'beat-type');
   if(bt&&btt){beats=Number(bt)||beats;beatType=Number(btt)||beatType;} else if(fm.attributes?.time){beats=Number(fm.attributes.time.beats)||beats;beatType=Number(fm.attributes.time['beat-type'])||beatType;}
   const keyBlock=(mb.match(/<key\b[^>]*>([\s\S]*?)<\/key>/i)||[])[1]||'';
   const fifthText=xmlTagText(keyBlock,'fifths'); if(fifthText!=='')fifths=Number(fifthText)||0; else if(fm.attributes?.key?.fifths!=null)fifths=Number(fm.attributes.key.fifths)||0;
   const nominalQ=beats*(4/beatType);
   measureMeta[mi]={beats,beatType,fifths,nominalQ};
   let cursor=0,lastStart=0,lastVoice='1';
   const tokens=mb?[...mb.matchAll(/<(note|backup|forward)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]:[];
   if(tokens.length){
    for(const tm of tokens){
     const kind=tm[1].toLowerCase(),body=tm[3];
     if(kind==='backup'||kind==='forward'){
      const d=(Number(xmlTagText(body,'duration'))||0)/divisions;
      cursor=Math.max(0,cursor+(kind==='backup'?-d:d));
      continue;
     }
     const durDiv=Number(xmlTagText(body,'duration')||0),rawDur=durDiv/divisions;
     const voice=xmlTagText(body,'voice')||lastVoice||'1'; lastVoice=voice; voices.add(voice);
     const isChord=/<chord\b[^>]*\/?\s*>/i.test(body);
     const isRest=/<rest\b/i.test(body);
     const measureRest=/<rest\b[^>]*\bmeasure\s*=\s*["']yes["']/i.test(body);
     const dur=measureRest&&rawDur>nominalQ+.0001?nominalQ:rawDur;
     const start=isChord?lastStart:cursor; if(!isChord)lastStart=start;
     const sourceStaff=Number(xmlTagText(body,'staff')||0)||0;
     const type=xmlTagText(body,'type');
     const dot=/<dot\b[^>]*\/?\s*>/i.test(body);
     const tieStart=/<tie\b[^>]*\btype\s*=\s*["']start["']/i.test(body)||/<tied\b[^>]*\btype\s*=\s*["']start["']/i.test(body);
     const tieStop=/<tie\b[^>]*\btype\s*=\s*["']stop["']/i.test(body)||/<tied\b[^>]*\btype\s*=\s*["']stop["']/i.test(body);
     if(!isRest && /<pitch\b/i.test(body)){
      const pitchBlock=(body.match(/<pitch\b[^>]*>([\s\S]*?)<\/pitch>/i)||[])[1]||'';
      const step=xmlTagText(pitchBlock,'step'),alt=Number(xmlTagText(pitchBlock,'alter')||0),oct=Number(xmlTagText(pitchBlock,'octave'));
      if(step in stepSemi && Number.isFinite(oct)){
       const midi=(oct+1)*12+stepSemi[step]+alt;
       const beams=[...body.matchAll(/<beam\b([^>]*)>([\s\S]*?)<\/beam>/gi)].map(b=>({number:Number(xmlAttr(b[1],'number')||1),value:String(b[2]||'').replace(/<[^>]+>/g,'').trim()})).filter(b=>b.value);
       events.push({voice,midi,step,alter:alt,octave:oct,measure:mi,start,dur:Math.max(dur,.0625),type,dot,beams,sourceStaff,isRest:false,tieStart,tieStop});
      }
     } else if(isRest && dur>0){
      events.push({voice,isRest:true,measure:mi,start,dur,type,dot,sourceStaff,measureRest});
     }
     if(!isChord)cursor+=dur;
    }
   }else{
    // Fallback for unusually serialized XML where regex tokenization finds nothing.
    for(const n of arr(fm.note)){
     const durDiv=Number(n.duration||0),rawDur=durDiv/divisions,v=String(n.voice||'1'); voices.add(v);
     const measureRest=n.rest!==undefined && typeof n.rest==='object'&&String(n.rest?.['@_measure']||'')==='yes';
     const dur=measureRest&&rawDur>nominalQ+.0001?nominalQ:rawDur;
     const start=n.chord!==undefined?lastStart:cursor;if(n.chord===undefined)lastStart=start;
     if(n.pitch){const step=String(n.pitch.step),alt=Number(n.pitch.alter||0),oct=Number(n.pitch.octave),midi=(oct+1)*12+stepSemi[step]+alt;events.push({voice:v,midi,step,alter:alt,octave:oct,measure:mi,start,dur:Math.max(dur,.0625),type:String(n.type||''),dot:n.dot!==undefined,beams:[],sourceStaff:Number(n.staff||0)||0,isRest:false});}
     else if(n.rest!==undefined&&dur>0)events.push({voice:v,isRest:true,measure:mi,start,dur,type:String(n.type||''),dot:n.dot!==undefined,sourceStaff:Number(n.staff||0)||0,measureRest});
     if(n.chord===undefined)cursor+=dur;
    }
   }
   mi++;
  }
  globalMeasures=Math.max(globalMeasures,mi);
  parts.push({id:partId,name:names[partId]||partId,voices:[...voices].sort(),events,meta:{beats,beatType,fifths,measures:mi,measureMeta}});
 }
 return {kind:'musicxml',parts,measures:globalMeasures,metadata:{title,subtitle,collection:source||rights,composer:cleanComposer,dates:dateMatch}};
}
function parseMidi(buf){const m=new Midi(buf);let max=0;const parts=m.tracks.map((t,i)=>({id:String(i),name:t.name||`Track ${i+1}`,voices:[`ch ${t.channel+1}`],events:t.notes.map(n=>{const s=n.ticks/m.header.ppq,d=n.durationTicks/m.header.ppq;max=Math.max(max,s+d);const pc=n.midi%12,oct=Math.floor(n.midi/12)-1,steps=['C','C','D','D','E','F','F','G','G','A','A','B'],alts=[0,1,0,1,0,0,1,0,1,0,1,0];return{voice:`ch ${t.channel+1}`,midi:n.midi,step:steps[pc],alter:alts[pc],octave:oct,measure:Math.floor(s/4),start:s%4,dur:d,type:''}}),meta:{beats:4,beatType:4,fifths:0,measures:Math.ceil(max/4)}}));return{kind:'midi',parts,measures:Math.ceil(max/4)}}
async function parseMXL(buf){const zip=await JSZip.loadAsync(buf);let rootPath='';const ce=zip.file('META-INF/container.xml');if(ce){const c=safeXmlParse(await ce.async('string'));const roots=arr(c?.container?.rootfiles?.rootfile);rootPath=roots.find(r=>String(r?.['@_media-type']||'').includes('musicxml'))?.['@_full-path']||roots[0]?.['@_full-path']||'';}if(!rootPath)rootPath=Object.keys(zip.files).find(n=>!zip.files[n].dir&&/\.(musicxml|xml)$/i.test(n)&&!/^META-INF\//i.test(n))||'';if(!rootPath||!zip.file(rootPath))throw Error('This .mxl archive does not contain a readable MusicXML score.');return parseXML(await zip.file(rootPath).async('nodebuffer'));}
app.post('/api/import',upload.single('score'),async(req,res)=>{try{if(!req.file)throw Error('Choose a score file first.');const b=req.file.buffer,n=req.file.originalname.toLowerCase(),zip=b.length>=4&&b[0]===0x50&&b[1]===0x4b,midi=b.subarray(0,4).toString('ascii')==='MThd',head=b.subarray(0,512).toString('utf8').replace(/^\uFEFF/,'').trimStart(),xml=head.startsWith('<?xml')||head.startsWith('<score-partwise');let parsed;if(midi)parsed=parseMidi(b);else if(zip)parsed=await parseMXL(b);else if(xml)parsed=parseXML(b);else if(/\.midi?$/.test(n))parsed=parseMidi(b);else if(/\.(mxl|musicxml|xml)$/.test(n))parsed=parseXML(b);else throw Error('Unsupported score file.');res.json(parsed);}catch(e){res.status(400).json({error:e.message})}});

function selectedStreams(parts,selected){const streams=[];let v=1,order=0;for(const p of parts)for(const voice of p.voices){const key=`${p.id}|${voice}`;if(selected.includes(key))streams.push({voiceNo:v++,order:order++,name:`${p.name} · ${voice}`,events:p.events.filter(e=>e.voice===voice)});}return streams;}
function typeFor(q){if(q>=8)return 'breve';if(q>=4)return 'whole';if(q>=2)return 'half';if(q>=1)return 'quarter';if(q>=.5)return 'eighth';if(q>=.25)return '16th';return '32nd';}
function beamXML(beams=[]){return beams.map(b=>`<beam number="${Number(b.number||1)}">${esc(b.value)}</beam>`).join('');}
function noteXML(e,voiceNo,div,chord=false,stem='',beams=[]){const d=Math.max(1,Math.round(e.dur*div)),staff=e.engravingStaff|| (e.midi>=60?1:2),tieStart=!!e.tieStart,tieStop=!!e.tieStop,ties=`${tieStop?'<tie type=\"stop\"/>':''}${tieStart?'<tie type=\"start\"/>':''}`,notations=(tieStart||tieStop)?`<notations>${tieStop?'<tied type=\"stop\"/>':''}${tieStart?'<tied type=\"start\"/>':''}</notations>`:'';return `<note>${chord?'<chord/>':''}<pitch><step>${esc(e.step)}</step>${e.alter?`<alter>${e.alter}</alter>`:''}<octave>${e.octave}</octave></pitch><duration>${d}</duration>${ties}<voice>${voiceNo}</voice><type>${typeFor(e.dur)}</type>${e.dot?'<dot/>':''}${stem?`<stem>${stem}</stem>`:''}${beamXML(beams)}<staff>${staff}</staff>${notations}</note>`;}
function restSpec(q){
 const vals=[
  [12,'breve',1],[8,'breve',0],[6,'whole',1],[4,'whole',0],[3,'half',1],[2,'half',0],[1.5,'quarter',1],[1,'quarter',0],
  [.75,'eighth',1],[.5,'eighth',0],[.375,'16th',1],[.25,'16th',0],[.1875,'32nd',1],[.125,'32nd',0]
 ];
 return vals.find(([v])=>Math.abs(q-v)<.0001)||null;
}
function restXML(q,voiceNo,div,staff,{measure=false}={}){
 if(q<=.0001)return '';
 if(measure)return `<note><rest measure="yes"/><duration>${Math.max(1,Math.round(q*div))}</duration><voice>${voiceNo}</voice><staff>${staff}</staff></note>`;
 const sp=restSpec(q),type=sp?sp[1]:typeFor(q),dots=sp?sp[2]:0;
 return `<note><rest/><duration>${Math.max(1,Math.round(q*div))}</duration><voice>${voiceNo}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}<staff>${staff}</staff></note>`;
}
// Re-notate genuine silence instead of copying parser/bookkeeping gaps verbatim. Pieces are
// split at the prevailing beat-group boundary, then expressed with the largest conventional
// rest value that fits. This keeps rests readable and avoids strings of tiny rests.
function restRunXML(start,q,voiceNo,div,staff,beats,beatType,measureQ){
 if(q<=.0001)return '';
 if(start<=.0001 && Math.abs(q-measureQ)<.0001)return restXML(q,voiceNo,div,staff,{measure:true});
 const compound=beatType===8 && beats>=6 && beats%3===0,groupQ=compound?1.5:(4/beatType);
 let pos=start,left=q,out='';
 const candidates=[4,3,2,1.5,1,.75,.5,.375,.25,.1875,.125];
 while(left>.0001){
  const nextBoundary=(Math.floor((pos+1e-7)/groupQ)+1)*groupQ;
  const room=Math.min(left,Math.max(.0001,nextBoundary-pos));
  let take=candidates.find(v=>v<=room+.0001 && restSpec(v));
  if(!take)take=Math.min(room,left);
  out+=restXML(take,voiceNo,div,staff);pos+=take;left-=take;
 }
 return out;
}
function stemAssignments(streams,m){
 const map=new Map(),groups=new Map();
 for(const s of streams) for(const e of s.events.filter(e=>(e.measure||0)===m && !e.isRest)){
   const staff=e.midi>=60?1:2,key=`${staff}|${Number(e.start||0).toFixed(5)}`;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push({s,e});
 }
 for(const items of groups.values()){
   const byStream=[...new Map(items.map(x=>[x.s.voiceNo,x])).values()].sort((a,b)=>Math.max(...b.s.events.filter(e=>e.measure===m&&Math.abs(e.start-a.e.start)<.0001&&(e.midi>=60?1:2)===(a.e.midi>=60?1:2)).map(e=>e.midi),b.e.midi)-Math.max(...a.s.events.filter(e=>e.measure===m&&Math.abs(e.start-a.e.start)<.0001&&(e.midi>=60?1:2)===(a.e.midi>=60?1:2)).map(e=>e.midi),a.e.midi));
   if(!byStream.length)continue;
   const top=byStream[0],bottom=byStream[byStream.length-1];
   map.set(`${top.s.voiceNo}|${m}|${top.e.start}`,'up');
   if(bottom.s.voiceNo!==top.s.voiceNo)map.set(`${bottom.s.voiceNo}|${m}|${bottom.e.start}`,'down');
   for(const x of byStream.slice(1,-1)){
     if(Math.abs(x.e.dur-bottom.e.dur)<.0001)map.set(`${x.s.voiceNo}|${m}|${x.e.start}`,'down');
     else if(Math.abs(x.e.dur-top.e.dur)<.0001)map.set(`${x.s.voiceNo}|${m}|${x.e.start}`,'up');
   }
 }
 return map;
}
function generatedBeams(es,beats,beatType){
 // Rebuild beams after condensation. Source beams may be invalid once voices/staves change.
 const out=new Map();
 const compound=beatType===8 && beats>=6 && beats%3===0;
 const groupQ=compound?1.5:(4/beatType);
 const beamable=e=>Number(e.dur||0)<=0.5+1e-6;
 const sameStaff=(a,b)=>(a.midi>=60)===(b.midi>=60);
 let i=0;
 while(i<es.length){
   const e=es[i];
   if(!beamable(e)){i++;continue}
   const groupStart=Math.floor((Number(e.start||0)+1e-7)/groupQ)*groupQ;
   const groupEnd=groupStart+groupQ;
   let j=i+1;
   while(j<es.length){
     const prev=es[j-1],cur=es[j];
     if(!beamable(cur)||!sameStaff(e,cur))break;
     if(Number(cur.start||0)>=groupEnd-1e-7)break;
     if(Math.abs((Number(prev.start||0)+Number(prev.dur||0))-Number(cur.start||0))>.001)break;
     if(j-i>=4)break; // Never beam more than four consecutive notes in one group.
     j++;
   }
   if(j-i>=2){
     // Primary beam: eighth-note level.
     for(let k=i;k<j;k++) out.set(k,[{number:1,value:k===i?'begin':k===j-1?'end':'continue'}]);
     // Secondary/tertiary beams for shorter values, with hooks for isolated short notes.
     for(let level=2;level<=3;level++){
       const maxDur=0.5/(2**(level-1));
       let k=i;
       while(k<j){
         if(Number(es[k].dur||0)>maxDur+1e-7){k++;continue}
         let z=k+1;
         while(z<j && Number(es[z].dur||0)<=maxDur+1e-7 && Math.abs((Number(es[z-1].start||0)+Number(es[z-1].dur||0))-Number(es[z].start||0))<.001)z++;
         if(z-k>=2){
           for(let q=k;q<z;q++) out.get(q).push({number:level,value:q===k?'begin':q===z-1?'end':'continue'});
         }else{
           const hook=(k===i)?'forward hook':'backward hook';
           out.get(k).push({number:level,value:hook});
         }
         k=z;
       }
     }
   }
   i=Math.max(j,i+1);
 }
 return out;
}
function forwardXML(q,div,voiceNo,staff){if(q<=.0001)return '';return `<forward><duration>${Math.max(1,Math.round(q*div))}</duration><voice>${voiceNo}</voice><staff>${staff}</staff></forward>`;}

// Build engraving lanes after condensation. Notes from different source voices that land
// at the same onset, staff, duration and stem-role become ONE chord event. This prevents
// doubled coincident stems and lets Verovio apply normal chord notehead displacement.
function condensedLanes(streams,m){
 const stems=stemAssignments(streams,m), raw=[];
 for(const s of streams) for(const e of s.events.filter(e=>(e.measure||0)===m && !e.isRest)){
   const staff=e.midi>=60?1:2, stem=stems.get(`${s.voiceNo}|${m}|${e.start}`)||'';
   raw.push({...e,sourceVoice:s.voiceNo,staff,stem});
 }
 const grouped=new Map();
 for(const e of raw){
   // Only explicitly compatible stem roles merge across source voices. Unassigned inner
   // voices stay independent, even if they happen to share an onset/duration.
   const role=e.stem || `independent-${e.sourceVoice}`;
   const key=[e.staff,Number(e.start||0).toFixed(5),Number(e.dur||0).toFixed(5),role].join('|');
   if(!grouped.has(key))grouped.set(key,{staff:e.staff,start:Number(e.start||0),dur:Number(e.dur||0),stem:e.stem,sourceVoice:e.sourceVoice,notes:[]});
   grouped.get(key).notes.push(e);
 }
 // Stable lane identities are important for beaming. Up/down layers share a lane across
 // measures; genuinely independent source voices retain their own lane.
 const laneMap=new Map();
 for(const g of grouped.values()){
   const role=g.stem || `v${g.sourceVoice}`;
   g.laneKey=`${g.staff}|${role}`;
   g.midi=g.stem==='up'?Math.max(...g.notes.map(n=>n.midi)):Math.min(...g.notes.map(n=>n.midi));
   if(!laneMap.has(g.laneKey))laneMap.set(g.laneKey,[]);
   laneMap.get(g.laneKey).push(g);
 }
 return [...laneMap.entries()].map(([key,events])=>({key,staff:events[0].staff,events:events.sort((a,b)=>a.start-b.start||a.midi-b.midi)}));
}

function inferredStreamStaff(stream){
 const notes=stream.events.filter(e=>!e.isRest && Number.isFinite(e.midi));
 if(!notes.length)return 1;
 const avg=notes.reduce((a,e)=>a+e.midi,0)/notes.length;
 return avg>=60?1:2;
}
function literalRestXML(e,voiceNo,div,staff){
 const q=Number(e.dur||0); if(q<=.0001)return '';
 if(e.measureRest)return restXML(q,voiceNo,div,staff,{measure:true});
 const type=e.type||typeFor(q),dots=e.dot?'<dot/>':'';
 return `<note><rest/><duration>${Math.max(1,Math.round(q*div))}</duration><voice>${voiceNo}</voice><type>${esc(type)}</type>${dots}<staff>${staff}</staff></note>`;
}
// Literal mode is intentionally archival: every source rest survives with its original onset,
// duration and source-voice identity. We use <forward> only to position that source material;
// no rests are invented, removed, combined or split here.
// Rhythmic grid: every emitted lane is reconciled against one authoritative duration.
// Quarter-note units are used internally. A pickup/short final bar keeps its real source span;
// ordinary measures use the notated meter duration.
function sourceMeasureEnd(streams,m){
 let end=0;for(const s of streams)for(const e of s.events.filter(e=>(e.measure||0)===m))end=Math.max(end,Number(e.start||0)+Number(e.dur||0));return end;
}
function measureTiming(first,streams,m,maxM){
 const mm=first?.meta?.measureMeta?.[m]||{},beats=Number(mm.beats||first?.meta?.beats||4),beatType=Number(mm.beatType||first?.meta?.beatType||4),nominalQ=beats*(4/beatType),sourceEnd=sourceMeasureEnd(streams,m);
 const shortEdge=(m===0||m===maxM)&&sourceEnd>.0001&&sourceEnd<nominalQ-.0001;
 // Imported/OMR MusicXML is occasionally overfull or uses non-barred phrase measures.
 // Preserve that material instead of crashing. The source span becomes authoritative
 // for this measure, while normal well-formed bars still use the notated meter.
 return {beats,beatType,nominalQ,targetQ:shortEdge?sourceEnd:Math.max(nominalQ,sourceEnd),irregular:sourceEnd>nominalQ+.0001};
}
function assertEventFits(e,targetQ,m,label){const start=Number(e.start||0),end=start+Number(e.dur||0);if(start<-.0001||end>targetQ+.0001)throw Error(`Rhythmic validation failed in measure ${m+1}, ${label}: event ${start.toFixed(3)}–${end.toFixed(3)} exceeds ${targetQ.toFixed(3)} beats.`);}
function padForward(cursor,targetQ,div,voiceNo,staff){return cursor<targetQ-.0001?forwardXML(targetQ-cursor,div,voiceNo,staff):'';}
function makeLiteralReduction(parts,selected,meta={}){
 const streams=selectedStreams(parts,selected);if(!streams.length)throw Error('Select at least one voice.');
 const first=parts.find(p=>selected.some(k=>k.startsWith(`${p.id}|`)))||parts[0],fifths=Number(first?.meta?.fifths||0),div=480,maxM=Math.max(0,...streams.flatMap(s=>s.events.map(e=>e.measure||0)));
 let measures='';
 for(let m=0;m<=maxM;m++){
  const timing=measureTiming(first,streams,m,maxM),beats=timing.beats,beatType=timing.beatType,targetQ=timing.targetQ;
  let body='';
  for(let si=0;si<streams.length;si++){
   const stream=streams[si],voiceNo=stream.voiceNo,defaultStaff=inferredStreamStaff(stream);
   const es=stream.events.filter(e=>(e.measure||0)===m).sort((a,b)=>Number(a.start||0)-Number(b.start||0)||(a.isRest?1:0)-(b.isRest?1:0));
   es.forEach(e=>assertEventFits(e,targetQ,m,stream.name));
   let cursor=0,lastStaff=defaultStaff;
   for(let i=0;i<es.length;i++){
    const e=es[i],start=Number(e.start||0),staff=e.sourceStaff||(!e.isRest?(e.midi>=60?1:2):lastStaff)||defaultStaff;
    if(start>cursor+.0001)body+=forwardXML(start-cursor,div,voiceNo,staff);
    if(e.isRest){body+=literalRestXML(e,voiceNo,div,staff);cursor=Math.max(cursor,start+Number(e.dur||0));}
    else{
     const same=es.filter(x=>!x.isRest&&Math.abs(Number(x.start||0)-start)<.0001&&Math.abs(Number(x.dur||0)-Number(e.dur||0))<.0001&&((x.sourceStaff||(x.midi>=60?1:2))===staff));
     if(same[0]!==e)continue;
     const stem='';same.sort((a,b)=>a.midi-b.midi).forEach((n,j)=>body+=noteXML(n,voiceNo,div,j>0,stem,j===0?n.beams:[]));
     cursor=Math.max(cursor,start+Number(e.dur||0));lastStaff=staff;
    }
   }
   body+=padForward(cursor,targetQ,div,voiceNo,lastStaff||defaultStaff);cursor=targetQ;
   if(si<streams.length-1)body+=`<backup><duration>${Math.round(targetQ*div)}</duration></backup>`;
  }
  const attrs=m===0?`<attributes><divisions>${div}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves><part-symbol>brace</part-symbol><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`:'';
  measures+=`<measure number="${m+1}"${targetQ<timing.nominalQ-.0001?' implicit="yes"':''}>${attrs}${body}</measure>`;
 }
 return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="4.0"><work><work-title>${esc(meta.title||'Untitled')}</work-title></work>${meta.subtitle?`<movement-title>${esc(meta.subtitle)}</movement-title>`:''}<identification><creator type="composer">${esc([meta.composer,meta.dates].filter(Boolean).join(' '))}</creator>${meta.collection?`<source>${esc(meta.collection)}</source>`:''}</identification><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
function makeReduction(parts,selected,meta={},transcription={}){
 // Literal mode now uses the same canonical onset/lane emitter as Intelligent mode so
 // simultaneous compatible pitches are true chords in both modes. Imported rests remain
 // source-owned and 100% preserved. Intelligent mode is still the place for future packing
 // heuristics, but neither mode gets a separate rhythmic/beaming pipeline.
 return makeIntelligentReduction(parts,selected,meta,{...transcription,literal:!transcription?.intelligent});
}

function canonicalNoteSignature(streams){
 const sig=[];
 for(const st of streams) for(const e of st.events){
  if(e.isRest)continue;
  sig.push([Number(e.measure||0),Number(e.start||0).toFixed(6),Number(e.dur||0).toFixed(6),Number(e.midi),String(e.step||''),Number(e.alter||0),Number(e.octave||0)].join('|'));
 }
 return sig.sort();
}
function beamFamilyKey(e){
 const beams=(e.beams||[]).map(b=>[Number(b.number||1),String(b.value||'')]);
 return JSON.stringify(beams);
}

function pitchFieldsFromMidi(midi){
 const pc=((Number(midi)%12)+12)%12,oct=Math.floor(Number(midi)/12)-1;
 const steps=['C','C','D','D','E','F','F','G','G','A','A','B'],alts=[0,1,0,1,0,0,1,0,1,0,1,0];
 return {midi:Number(midi),step:steps[pc],alter:alts[pc],octave:oct};
}
function sourceMeter(first,m){
 const mm=first?.meta?.measureMeta?.[m]||{};
 const beats=Number(mm.beats||first?.meta?.beats||4),beatType=Number(mm.beatType||first?.meta?.beatType||4);
 return {beats,beatType,nominalQ:beats*(4/beatType)};
}
function earlyAugmentationForMeasure(first,m,mode){
 const src=sourceMeter(first,m),eps=.0001;
 if(mode==='off'||!mode)return {...src,augment:false,targetBeats:src.beats,targetBeatType:src.beatType,targetQ:src.nominalQ};
 // The operation means augmentation, not merely relabelling the meter:
 // source spans equivalent to 2/4 become 2/2 and 3/4 become 3/2 while every
 // note/rest and onset doubles. "auto" handles mixed 2/4 + 3/4 sources.
 if(Math.abs(src.nominalQ-2)<eps && (mode==='auto'||mode==='2/2'))return {...src,augment:true,targetBeats:2,targetBeatType:2,targetQ:4};
 if(Math.abs(src.nominalQ-3)<eps && (mode==='auto'||mode==='3/2'))return {...src,augment:true,targetBeats:3,targetBeatType:2,targetQ:6};
 return {...src,augment:false,targetBeats:src.beats,targetBeatType:src.beatType,targetQ:src.nominalQ};
}
function transformStreamsForEdition(streams,intelligence={},first){
 const semitones=Math.max(-24,Math.min(24,Number(intelligence.transposeSemitones||0)||0));
 const earlyMode=String(intelligence.earlyMusicMode||'off');
 return streams.map(st=>({...st,events:st.events.map(e=>{
   let out={...e};
   const em=earlyAugmentationForMeasure(first,Number(out.measure||0),earlyMode);
   if(em.augment){
     out.start=Number(out.start||0)*2;
     out.dur=Number(out.dur||0)*2;
     out.type='';out.beams=[];
   }
   if(!out.isRest && semitones){out={...out,...pitchFieldsFromMidi(Number(out.midi)+semitones)};}
   return out;
 })}));
}
function editionMeasureTiming(first,streams,m,maxM,intelligence={}){
 const mode=String(intelligence.earlyMusicMode||'off'),em=earlyAugmentationForMeasure(first,m,mode);
 if(!em.augment)return measureTiming(first,streams,m,maxM);
 const sourceEnd=sourceMeasureEnd(streams,m),nominalQ=em.targetQ;
 const shortEdge=(m===0||m===maxM)&&sourceEnd>.0001&&sourceEnd<nominalQ-.0001;
 // Never reject a whole score because one imported measure is irregular. For an eligible
 // 2/4→2/2 or 3/4→3/2 bar, normal output is exactly 4Q or 6Q; overfull OMR/source bars
 // retain their full span and are marked irregular internally rather than truncated.
 return {beats:em.targetBeats,beatType:em.targetBeatType,nominalQ,targetQ:shortEdge?sourceEnd:Math.max(nominalQ,sourceEnd),irregular:sourceEnd>nominalQ+.0001,augmented:true};
}

function intelligentOctaveNormalize(e,staff,range){
 // Intelligent-only pitch folding. Bass-staff candidates more than an octave above the
 // measure's lowest bass pitch move down one octave; treble-staff candidates more than
 // an octave below the measure's highest treble pitch move up one octave. Exactly one
 // octave move is permitted. Rhythm is never changed. If that one move escapes the
 // source texture's outer pitch bounds, omit the candidate.
 let midi=Number(e.midi),shifted=false;
 if(staff===2 && Number.isFinite(range.lowBass) && midi>range.lowBass+12){midi-=12;shifted=true;}
 else if(staff===1 && Number.isFinite(range.highTreble) && midi<range.highTreble-12){midi+=12;shifted=true;}
 if(shifted && ((Number.isFinite(range.highTreble)&&midi>range.highTreble)||(Number.isFinite(range.lowBass)&&midi<range.lowBass)))return null;
 if(!shifted)return {...e};
 return {...e,...pitchFieldsFromMidi(midi),tieStart:false,tieStop:false,intelligentOctaveShift:midi-Number(e.midi)};
}

// When the same pitch begins simultaneously in independent rhythms, expose the shorter
// rhythm by re-spelling the longer sounding note as tied segments. Example: a half-note C
// against a quarter-note C becomes quarter C tied to quarter C. Sounding duration is unchanged.
function splitSamePitchRhythms(items){
 const buckets=new Map();
 for(const item of items){
  const e=item.e,key=[item.staff,Number(e.start||0).toFixed(6),Number(e.midi)].join('|');
  if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(item);
 }
 const out=[];
 for(const bucket of buckets.values()){
  const durations=[...new Set(bucket.map(x=>Number(x.e.dur||0)).filter(x=>x>.000001))].sort((a,b)=>a-b);
  if(durations.length<2){out.push(...bucket);continue;}
  for(const item of bucket){
   const total=Number(item.e.dur||0),cuts=durations.filter(d=>d<total-.000001),bounds=[0,...cuts,total];
   if(bounds.length===2){out.push(item);continue;}
   for(let i=0;i<bounds.length-1;i++){
    const a=bounds[i],b=bounds[i+1];
    out.push({...item,e:{...item.e,start:Number(item.e.start||0)+a,dur:b-a,dot:false,beams:[],tieStop:i>0||!!item.e.tieStop,tieStart:i<bounds.length-2||!!item.e.tieStart,rhythmSplit:true}});
   }
  }
 }
 return out;
}

function makeIntelligentReduction(parts,selected,meta={},intelligence={}){
 const literal=!!intelligence.literal;
 // Canonical rule: literal import owns rhythm. Intelligent mode may only change engraving
 // ownership (staff/voice/stem/chord). Pitch, onset and duration are immutable.
 const sourceStreams=selectedStreams(parts,selected);if(!sourceStreams.length)throw Error('Select at least one voice.');
 const first=parts.find(p=>selected.some(k=>k.startsWith(`${p.id}|`)))||parts[0];
 const streams=transformStreamsForEdition(sourceStreams,intelligence,first);
 const canonical=canonicalNoteSignature(streams);
 const fifths=Number(first?.meta?.fifths||0),div=480,maxM=Math.max(0,...streams.flatMap(s=>s.events.map(e=>e.measure||0)));
 let measures='', emittedSignature=[];
 for(let m=0;m<=maxM;m++){
  const timing=editionMeasureTiming(first,streams,m,maxM,intelligence),beats=timing.beats,beatType=timing.beatType,targetQ=timing.targetQ;
  let body='',voiceCounter=0;
  const stems=stemAssignments(streams,m);
  // Outer pitch bounds are measured from the unmodified source texture for this measure.
  // They are anchors/guards only; Literal mode never calls the octave normalizer.
  const sourceNotes=streams.flatMap(st=>st.events.filter(e=>(e.measure||0)===m&&!e.isRest));
  const bassSource=sourceNotes.filter(e=>(e.sourceStaff||(e.midi>=60?1:2))===2).map(e=>Number(e.midi));
  const trebleSource=sourceNotes.filter(e=>(e.sourceStaff||(e.midi>=60?1:2))===1).map(e=>Number(e.midi));
  const octaveRange={lowBass:bassSource.length?Math.min(...bassSource):NaN,highTreble:trebleSource.length?Math.max(...trebleSource):NaN};

  // First make true simultaneous chord groups. A chord is legal only when onset, duration,
  // staff, stem-role and beam state agree. Exact duplicate pitches are de-duplicated visually
  // but still represented in the validation signature below.
  const chordGroups=new Map(),prepared=[];
  for(const st of streams) for(const sourceEvent of st.events.filter(e=>(e.measure||0)===m&&!e.isRest)){
   assertEventFits(sourceEvent,targetQ,m,st.name);
   const staff=sourceEvent.sourceStaff||(sourceEvent.midi>=60?1:2),stem=stems.get(`${st.voiceNo}|${m}|${sourceEvent.start}`)||'';
   const useOctaves=!literal && !!intelligence.octaveTranscription;
   const e=useOctaves?intelligentOctaveNormalize(sourceEvent,staff,octaveRange):{...sourceEvent};
   if(!e)continue;
   // Octave transcription may alter/omit pitch only. It may not move or resize a source note.
   if(Number(e.start)!==Number(sourceEvent.start)||Number(e.dur)!==Number(sourceEvent.dur)||Number(e.measure||0)!==Number(sourceEvent.measure||0))throw Error('Octave transcription changed rhythmic placement.');
   emittedSignature.push([m,Number(e.start||0).toFixed(6),Number(e.dur||0).toFixed(6),Number(e.midi),String(e.step||''),Number(e.alter||0),Number(e.octave||0)].join('|'));
   const sourceEventId=`m${m}-v${st.voiceNo}-s${Number(sourceEvent.start||0).toFixed(6)}-p${Number(sourceEvent.midi)}-d${Number(sourceEvent.dur||0).toFixed(6)}`;
   prepared.push({st,sourceEvent,sourceEventId,e:{...e,engravingStaff:staff,sourceEventId},staff,stem});
  }
  // This engraving-only split is deliberately after source validation and octave processing:
  // it changes notation into tied segments without changing the source note's sounding span.
  for(const preparedItem of splitSamePitchRhythms(prepared)){
   const {st,e,staff,stem}=preparedItem;
   const strength=String(intelligence.strength||'balanced');
   const hasBeam=(e.beams||[]).length>0;
   // Literal mode stays source-faithful except that simultaneous, rhythmically identical
   // pitches with the same graphical stem role may form a real chord. Intelligent mode is
   // deliberately different: source voice identity is discarded for note ownership and
   // compatible notes are packed into the two keyboard stem roles. Beams are regenerated
   // after packing, so a source beam can never prevent otherwise valid condensation.
   let role=stem;
   if(!role && !literal){
     if(strength==='compact') role=staff===1?'up':'down';
     else if(strength==='balanced') role=staff===1?(e.midi>=67?'up':'down'):(e.midi>=53?'up':'down');
   }
   const baseOwner=literal?(hasBeam?`src${st.voiceNo}`:(role||`src${st.voiceNo}`)):(role||`src${st.voiceNo}`);
   // A tied segment created to expose a shorter coincident rhythm must remain in its own
   // logical voice. If it merges into another identical pitch/chord, Verovio can resolve the
   // tie to a distant note and draw the huge arc seen with octave transcription.
   const owner=(e.rhythmSplit||e.tieStart||e.tieStop)?`${baseOwner}|tie|${e.sourceEventId||st.voiceNo}`:baseOwner;
   const beamKey=literal?beamFamilyKey(e):'rebeam';
   const key=[staff,Number(e.start||0).toFixed(6),Number(e.dur||0).toFixed(6),owner,beamKey].join('|');
   if(!chordGroups.has(key))chordGroups.set(key,{staff,start:Number(e.start||0),dur:Number(e.dur||0),stem:role,owner,sourceVoice:st.voiceNo,beams:literal?(e.beams||[]):[],notes:[]});
   chordGroups.get(key).notes.push(e);
  }

  // Interval-safe lane packing. CRITICAL: an event can enter a lane only if that lane's
  // previous event has ended. v13 violated this rule; MusicXML then emitted a later-onset
  // event while the cursor was already beyond it, which made Verovio place it late.
  const byStaff=new Map([[1,[]],[2,[]]]);
  const groups=[...chordGroups.values()].sort((a,b)=>a.staff-b.staff||a.start-b.start||b.dur-a.dur||a.owner.localeCompare(b.owner));
  for(const g of groups){
   const lanes=byStaff.get(g.staff);let lane=null;
   // In intelligent mode, up/down are persistent engraving layers. Prefer the matching
   // layer first, then any free layer. Only create an additional lane when independent
   // durations genuinely overlap and therefore cannot legally share a MusicXML voice.
   lane=lanes.find(l=>l.owner===g.owner && l.end<=g.start+.000001);
   const graphicalRole=g.stem==='up'||g.stem==='down'?g.stem:'';
   if(!lane && !literal && graphicalRole){
     lane=lanes.find(l=>l.role===graphicalRole && l.end<=g.start+.000001 && !String(g.owner).includes('|tie|'));
   }
   if(!lane) lane=lanes.find(l=>l.end<=g.start+.000001 && (literal?!(g.beams||[]).length:true));
   if(!lane){lane={staff:g.staff,owner:g.owner,role:graphicalRole,end:0,events:[]};lanes.push(lane);}
   if(!lane.role && graphicalRole)lane.role=graphicalRole;
   lane.events.push(g);lane.end=Math.max(lane.end,g.start+g.dur);
  }

  // Emit notes. Every lane has its own cursor and is rewound exactly one measure afterward.
  // Therefore horizontal placement comes only from canonical measure-relative onset.
  const noteLanes=[...byStaff.get(1),...byStaff.get(2)];
  for(let li=0;li<noteLanes.length;li++){
   const lane=noteLanes[li],voiceNo=++voiceCounter,staff=lane.staff;let cursor=0;
   const ordered=lane.events.sort((a,b)=>a.start-b.start||b.dur-a.dur);
   // Beaming is generated only after final lane assignment. This prevents orphan beams and
   // imposes the edition rule that no eighth/sixteenth beam group exceeds four notes.
   const beamEvents=ordered.map(g=>({start:g.start,dur:g.dur,midi:g.notes[0]?.midi??60}));
   const laneBeams=generatedBeams(beamEvents,beats,beatType);
   for(let gi=0;gi<ordered.length;gi++){
    const g=ordered[gi];
    if(g.start<cursor-.0001)throw Error(`Intelligent transcription overlap in measure ${m+1}: onset ${g.start.toFixed(3)} occurs before lane cursor ${cursor.toFixed(3)}.`);
    if(g.start>cursor+.0001)body+=forwardXML(g.start-cursor,div,voiceNo,staff);
    const unique=[...new Map(g.notes.sort((a,b)=>a.midi-b.midi).map(n=>[`${n.midi}|${n.step}|${n.alter}|${n.octave}`,n])).values()];
    unique.forEach((e,j)=>body+=noteXML(e,voiceNo,div,j>0,j===0?g.stem:'',j===0?(laneBeams.get(gi)||[]):[]));
    cursor=g.start+g.dur;
   }
   body+=padForward(cursor,targetQ,div,voiceNo,staff);
   if(li<noteLanes.length-1 || streams.some(st=>st.events.some(e=>(e.measure||0)===m&&e.isRest)))body+=`<backup><duration>${Math.round(targetQ*div)}</duration></backup>`;
  }

  // Preserve every imported rest exactly. They remain source-owned so they cannot perturb
  // note-lane cursors. This is intentionally conservative even when it creates extra voices.
  const restStreams=streams.filter(st=>st.events.some(e=>(e.measure||0)===m&&e.isRest));
  for(let ri=0;ri<restStreams.length;ri++){
   const st=restStreams[ri],rests=st.events.filter(e=>(e.measure||0)===m&&e.isRest).sort((a,b)=>Number(a.start||0)-Number(b.start||0));
   const voiceNo=++voiceCounter,defaultStaff=inferredStreamStaff(st);let cursor=0,lastStaff=defaultStaff;
   for(const e of rests){
    assertEventFits(e,targetQ,m,st.name);const start=Number(e.start||0),staff=e.sourceStaff||lastStaff||defaultStaff;
    if(start<cursor-.0001)throw Error(`Overlapping source rests in measure ${m+1}, ${st.name}.`);
    if(start>cursor+.0001)body+=forwardXML(start-cursor,div,voiceNo,staff);
    body+=literalRestXML(e,voiceNo,div,staff);cursor=start+Number(e.dur||0);lastStaff=staff;
   }
   body+=padForward(cursor,targetQ,div,voiceNo,lastStaff);
   if(ri<restStreams.length-1)body+=`<backup><duration>${Math.round(targetQ*div)}</duration></backup>`;
  }
  const attrs=m===0?`<attributes><divisions>${div}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves><part-symbol>brace</part-symbol><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`:'';
  measures+=`<measure number="${m+1}"${targetQ<timing.nominalQ-.0001?' implicit="yes"':''}>${attrs}${body}</measure>`;
 }
 emittedSignature.sort();
 if(literal && (canonical.length!==emittedSignature.length || canonical.some((v,i)=>v!==emittedSignature[i])))throw Error('Literal transcription safety check failed: a note pitch, onset, or duration changed.');
 return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="4.0"><work><work-title>${esc(meta.title||'Untitled')}</work-title></work>${meta.subtitle?`<movement-title>${esc(meta.subtitle)}</movement-title>`:''}<identification><creator type="composer">${esc([meta.composer,meta.dates].filter(Boolean).join(' '))}</creator>${meta.collection?`<source>${esc(meta.collection)}</source>`:''}</identification><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function responseOutputText(j){
 if(typeof j?.output_text==='string')return j.output_text;
 return arr(j?.output).flatMap(o=>arr(o?.content)).filter(c=>c?.type==='output_text').map(c=>String(c.text||'')).join('\n');
}
function extractMusicXML(text=''){
 const cleaned=String(text).replace(/^```(?:xml|musicxml)?\s*/i,'').replace(/```\s*$/,'').trim();
 // Accept ordinary or namespace-prefixed MusicXML roots. We strip only the root prefix;
 // safeXmlParse(removeNSPrefix:true) handles any remaining prefixed element names.
 const open=cleaned.match(/<(?:[A-Za-z_][\w.-]*:)?score-partwise\b/i);
 const closes=[...cleaned.matchAll(/<\/(?:[A-Za-z_][\w.-]*:)?score-partwise\s*>/gi)];
 if(!open||!closes.length){
  if(/<(?:[A-Za-z_][\w.-]*:)?score-timewise\b/i.test(cleaned))throw Error('OMR returned score-timewise MusicXML instead of score-partwise. Verification was not run, so no second model call was charged.');
  throw Error('OMR did not return a complete score-partwise MusicXML document. Verification was not run, so no second model call was charged.');
 }
 const start=open.index,endMatch=closes[closes.length-1],end=endMatch.index+endMatch[0].length;
 let xml=cleaned.slice(start,end);
 // Normalize a namespace prefix on the document root so downstream validators can use
 // the same code path as uploaded MusicXML. Child prefixes are removed by the parser.
 xml=xml.replace(/^<([A-Za-z_][\w.-]*):score-partwise\b/i,'<score-partwise')
        .replace(/<\/([A-Za-z_][\w.-]*):score-partwise\s*>\s*$/i,'</score-partwise>');
 return xml;
}
function validateOmrPartwise(xml=''){
 const parsed=safeXmlParse(String(xml));
 const score=parsed?.['score-partwise'];
 if(!score)throw Error('OMR output is not a MusicXML score-partwise document.');
 if(!score['part-list']||!arr(score.part).length)throw Error('OMR output is missing its part-list or musical parts.');
 return true;
}
function sanitizeMusicOnlyXML(xml=''){
 // This is intentionally narrow: remove textual payloads while keeping musical
 // directions such as dynamics, wedges and metronome marks intact.
 return String(xml)
  .replace(/<lyric\b[\s\S]*?<\/lyric>/gi,'')
  .replace(/<credit\b[\s\S]*?<\/credit>/gi,'')
  .replace(/<words\b[^>]*>[\s\S]*?<\/words>/gi,'');
}
app.post('/api/visual-transcribe',upload.array('visualScores',20),async(req,res)=>{const fileIds=[];try{
 const files=Array.isArray(req.files)?req.files:[];
 if(!files.length)throw Error('Choose at least one PDF or score image first.');
 const apiKey=process.env.OPENAI_API_KEY;
 if(!apiKey)throw Error('Visual transcription needs OPENAI_API_KEY configured in Render.');
 const requestedModel=String(req.body?.model||'');
 const model=['gpt-5.6-luna','gpt-5.6-terra'].includes(requestedModel)?requestedModel:(process.env.OMR_MODEL||'gpt-5.6-terra');
 const profile=String(req.body?.profile||'historical')==='modern'?'modern':'historical';
 const musicOnly=String(req.body?.musicOnly||'1')!=='0';
 const verify=String(req.body?.verify||'1')!=='0';

 for(const f of files){
  const mime=f.mimetype||(/\.pdf$/i.test(f.originalname)?'application/pdf':'image/png');
  const fd=new FormData();fd.append('purpose','user_data');fd.append('file',new Blob([f.buffer],{type:mime}),f.originalname||'score-page');
  const fr=await fetch('https://api.openai.com/v1/files',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:fd});
  const fj=await fr.json();if(!fr.ok)throw Error(fj?.error?.message||`Could not upload ${f.originalname||'score image'} for visual transcription.`);
  fileIds.push(fj.id);
 }
 const profileRules=profile==='historical'?`HISTORICAL / EARLY-MUSIC PROFILE:\n- Expect scans, uneven print, old fonts, unusual spacing, C/F/G clefs, breves, long values, proportional signs, repeat signs, old-looking rests and dense chordal writing.\n- Do not mistake hollow noteheads, breve noteheads, mensuration-like signs, clefs, accidentals or old rest shapes for text or printing noise.\n- Encode written values literally. Use <type>breve</type> for breves; use <type>long</type> or <type>maxima</type> when clearly present. Preserve dots and ties.\n- If the notation is modernized early music, still preserve the printed rhythm exactly rather than normalizing it.`:`MODERN ENGRAVING PROFILE:\n- Treat the source as conventional modern staff notation while preserving all written pitches, rhythms, clefs, rests, ties, repeats and voices.`;
 const textRule=musicOnly?`MUSIC-ONLY RULE (MANDATORY): exclude ALL lyrics, underlay, titles, prose, poetry, verse blocks, movement labels, page numbers, captions, editorial footnotes and other non-musical text. Do not put them into <lyric>, <credit>, <words>, <direction>, part names, or metadata. Only musical notation and neutral generated part names such as Part 1 / Staff 1 may appear.`:`Text may be retained only when it is structurally necessary to the music.`;
 const fileOrder=files.map((f,i)=>`${i+1}. ${f.originalname||`image ${i+1}`}`).join('\n');
 const prompt=`You are a literal optical music recognition engine. Convert ALL attached printed music files into ONE continuous valid MusicXML 4.0 score-partwise document. Return ONLY XML, no Markdown. The attachments are consecutive source pages/images in this exact order:\n${fileOrder}\n\n${textRule}\n\n${profileRules}\n\nACCURACY RULES — THESE OVERRIDE GUESSING:\n1. First locate every music system and every staff. Ignore all pixels outside music systems when Music-only mode is active.\n2. Read EACH STAFF independently before combining anything. Never infer harmony from neighboring staves. A note pitch must come from its vertical staff position plus the active clef/key/accidental context.\n3. For every measure, explicitly account for every printed notehead/rest and its duration. Chords require vertically aligned noteheads at the same onset. Do not create isolated notes, ornaments, accidentals, rests, or chords unless they are visibly present.\n4. Preserve each source staff/part separately and track the same staff across systems/pages. DO NOT collapse a multi-staff source into a keyboard reduction.\n5. Detect barlines and measures first, then transcribe measure-by-measure. Preserve every visible pitch, accidental, clef, key signature, meter/mensuration-equivalent sign, rest, beam, tie, augmentation dot, pickup, repeat and ending.\n6. Use separate <voice> values for simultaneous independent rhythms. Use correct MusicXML <backup>/<forward> so each voice has its literal measure-relative onset.\n7. Full-measure rests occupy exactly one measure. Never use one rest to span several measures.\n8. When uncertain about a symbol, do NOT invent a plausible note. Prefer an explicit rest only if a rest is actually visible; otherwise keep the surrounding measure structure conservative.\n9. Output literal SOURCE TRANSCRIPTION only. Do not transpose, octave-fold, condense, harmonize, simplify or keyboard-arrange it.\n10. Multiple uploaded images are consecutive pages/regions of the SAME score unless the notation itself clearly proves otherwise. Preserve continuity between them.\n\nSELF-CHECK BEFORE ANSWERING:\n- Re-scan each system from left to right and compare the MusicXML measure-by-measure against the image.\n- Check every pitch against clef + staff position, especially ledger-line notes.\n- Check every accidental and chord note individually.\n- Check each voice's duration sum against the printed meter.\n- Dense source measures must not become empty; blank source measures must not gain invented notes.\n- Do not output any textual/lyric material when Music-only is on.`;
 const sourceContent=fileIds.map(id=>({type:'input_file',file_id:id}));
 sourceContent.push({type:'input_text',text:prompt});
 const rr=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'user',content:sourceContent}],reasoning:{effort:'high'},max_output_tokens:96000})});
 const rj=await rr.json();if(!rr.ok)throw Error(rj?.error?.message||'Visual transcription failed.');
 let xml=extractMusicXML(responseOutputText(rj));
 validateOmrPartwise(xml); // Never spend a second model call trying to repair a structurally invalid first response.
 let verificationUsage=null,verificationWarning='';

 if(verify){
  const audit=`Audit the draft MusicXML below against EVERY attached source image/PDF at symbol level, then return a COMPLETE corrected MusicXML 4.0 score-partwise document only. Do not explain changes.\n\nThis is a correction pass, not a creative transcription. Remove hallucinated/random notes. Correct every visibly mismatched pitch, octave, accidental, chord member, rest, onset and duration. Preserve source staff separation. Respect clefs and key signatures measure by measure. Check each measure from left to right against the pixels. Do not add lyrics or prose. Keep breves/long values literal. Ensure independent voices use <backup>/<forward> correctly. If the draft and source disagree, the SOURCE IMAGE wins.\n\nDRAFT MUSICXML:\n${xml}`;
  const verifyContent=fileIds.map(id=>({type:'input_file',file_id:id}));
  verifyContent.push({type:'input_text',text:audit});
  const vr=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:[{role:'user',content:verifyContent}],reasoning:{effort:'high'},max_output_tokens:96000})});
  const vj=await vr.json();if(!vr.ok)throw Error(vj?.error?.message||'OMR verification pass failed.');
  verificationUsage=vj?.usage||null;
  try{
   const checked=extractMusicXML(responseOutputText(vj));
   validateOmrPartwise(checked);
   xml=checked;
  }catch(verifyShapeError){
   // The first pass was already structurally valid. Do not throw away a paid successful
   // transcription merely because the optional verifier returned prose/timewise/broken XML.
   verificationWarning=`Verification output was unusable (${verifyShapeError.message}); kept the valid first-pass transcription.`;
  }
 }

 if(musicOnly)xml=sanitizeMusicOnlyXML(xml);
 validateOmrPartwise(xml);
 const parsed=parseXML(Buffer.from(xml));
 const noteCount=parsed.parts.reduce((n,p)=>n+p.events.filter(e=>!e.isRest).length,0);
 const eventCount=parsed.parts.reduce((n,p)=>n+p.events.length,0);
 const measureCount=parsed.measures||0;
 const warnings=[];
 if(verificationWarning)warnings.push(verificationWarning);
 if(noteCount<10)warnings.push('OMR completeness warning: extremely few notes were recognized.');
 if(measureCount>=8&&noteCount/measureCount<2)warnings.push('OMR completeness warning: the result is suspiciously sparse; inspect it before condensing.');
 let timingIssues=0;
 for(const p of parsed.parts)for(let m=0;m<(p.meta?.measures||0);m++){
  const meta=p.meta?.measureMeta?.[m],q=Number(meta?.nominalQ||0);if(!q)continue;
  for(const e of p.events.filter(e=>e.measure===m))if(Number(e.start||0)<-.0001||Number(e.start||0)+Number(e.dur||0)>q+.01)timingIssues++;
 }
 if(timingIssues)warnings.push(`OMR timing warning: ${timingIssues} event${timingIssues===1?'':'s'} fall outside their printed measure; inspect those measures.`);
 if(!parsed.parts.length)throw Error('OMR returned no musical parts.');
 res.json({score:parsed,musicxml:xml,model,profile,musicOnly,verified:verify,fileCount:files.length,noteCount,eventCount,measureCount,warnings,usage:{transcription:rj?.usage||null,verification:verificationUsage}});
 }catch(e){console.error(e);res.status(400).json({error:e.message});}
 finally{for(const id of fileIds)if(id&&process.env.OPENAI_API_KEY)fetch(`https://api.openai.com/v1/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}}).catch(()=>{});}
});

let toolkitPromise;
async function getToolkit(){if(!toolkitPromise)toolkitPromise=createVerovioModule().then(m=>new VerovioToolkit(m));return toolkitPromise;}
function engravingGeometry(layout={}){const landscape=layout.orientation==='landscape',base=layout.pageSize==='a4'?{w:2100,h:2970,pw:595.28,ph:841.89}:{w:2159,h:2794,pw:612,ph:792};return landscape?{w:base.h,h:base.w,pw:base.ph,ph:base.pw}:{w:base.w,h:base.h,pw:base.pw,ph:base.ph};}
function engravingOptions(layout={}){const {w,h}=engravingGeometry(layout),scale=Number(layout.scale||42),spacing=Number(layout.noteSpacing||1),stretch=Number(layout.barStretch||1),staff=Number(layout.staffSpacing||12),system=Number(layout.systemSpacing||10),margin=Number(layout.margin||60);return{pageWidth:w,pageHeight:h,pageMarginTop:margin,pageMarginBottom:margin,pageMarginLeft:margin,pageMarginRight:margin,scale,breaks:'auto',header:'auto',footer:'none',font:'Leipzig',spacingLinear:.25*spacing*stretch,spacingNonLinear:.6*spacing,spacingStaff:staff,spacingSystem:system,justifyVertically:false,systemDivider:'none'};}
async function renderScore(body){const {parts,selected,meta={},layout={},transcription={}}=body;const xml=makeReduction(parts,selected,meta,transcription);const tk=await getToolkit();tk.setOptions(engravingOptions(layout));tk.loadData(xml);const pages=[];for(let i=1;i<=tk.getPageCount();i++)pages.push(tk.renderToSVG(i,{}));return{xml,pages,layout};}
app.post('/api/engrave',async(req,res)=>{try{const r=await renderScore(req.body);res.json({pages:r.pages,musicxml:r.xml,pageCount:r.pages.length});}catch(e){console.error(e);res.status(400).json({error:e.message})}});
app.post('/api/pdf',async(req,res)=>{try{
 // PDF contains raster page images only. The browser rasterizes the exact rendered preview
 // page at Verovio's full page pixel dimensions; this endpoint simply places that PNG on
 // the matching physical PDF page. No SVG parser/converter is involved here.
 const pages=Array.isArray(req.body?.pages)?req.body.pages:[],layout=req.body?.layout||{};
 if(!pages.length)throw Error('Preview the score before downloading the PDF.');
 const g=engravingGeometry(layout);
 res.setHeader('Content-Type','application/pdf');
 res.setHeader('Content-Disposition','attachment; filename="keyboard-reduction.pdf"');
 const doc=new PDFDocument({autoFirstPage:false,compress:true,info:{Title:String(req.body?.title||'Keyboard reduction')}});
 doc.pipe(res);
 for(const page of pages){
  let b64='';
  if(typeof page==='string'&&page.startsWith('data:image/png;base64,'))b64=page.slice(page.indexOf(',')+1);
  else if(page&&page.mime==='image/png'&&typeof page.base64==='string')b64=page.base64;
  else throw Error('PDF page rasterization did not produce PNG data.');
  const png=Buffer.from(b64,'base64');
  // PNG signature validation: 89 50 4E 47 0D 0A 1A 0A
  if(png.length<8||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PDF page rasterization produced invalid PNG data.');
  doc.addPage({size:[g.pw,g.ph],margin:0});
  doc.image(png,0,0,{width:g.pw,height:g.ph});
 }
 doc.end();
}catch(e){console.error(e);if(!res.headersSent)res.status(400).json({error:e.message});else res.end();}});
app.listen(process.env.PORT||3000,()=>console.log('Score Condensor running with Verovio engraving'));
