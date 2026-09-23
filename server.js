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

function parseXML(buf){
 const x=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,preserveOrder:false}).parse(buf.toString());
 const score=x['score-partwise']; if(!score) throw Error('This app expects a MusicXML score-partwise document.');
 const names={}; for(const p of arr(score['part-list']?.['score-part'])) names[p['@_id']]=String(p['part-name']||p['@_id']);
 const credits=arr(score.credit).flatMap(c=>arr(c?.['credit-words']).map(w=>typeof w==='object'?String(w['#text']||''):String(w))).map(v=>v.trim()).filter(Boolean);
 const creators=arr(score.identification?.creator);
 const composerNode=creators.find(c=>typeof c==='object'&&String(c['@_type']||'').toLowerCase()==='composer')||creators[0];
 const composer=typeof composerNode==='object'?String(composerNode?.['#text']||''):String(composerNode||'');
 const title=String(score.work?.['work-title']||score['movement-title']||credits[0]||'').trim();
 const movement=String(score['movement-title']||'').trim();
 const descriptiveCredit=credits.find(c=>c!==title && c!==composer && !/^\[?an[oó]nimo\]?$/i.test(c))||'';
 const subtitle=movement || descriptiveCredit;
 const rights=arr(score.identification?.rights).map(r=>typeof r==='object'?r['#text']:r).filter(Boolean).join(' · ');
 const source=String(score.identification?.source||'').trim();
 const dateMatch=(composer.match(/(?:c\.?\s*)?\d{3,4}\s*[–—-]\s*(?:c\.?\s*)?\d{2,4}/)||[])[0]||'';
 const cleanComposer=dateMatch?composer.replace(dateMatch,'').replace(/[(),;\s]+$/,'').trim():composer;
 const parts=[]; let globalMeasures=0;
 for(const p of arr(score.part)){
  const voices=new Set(), events=[], measureMeta=[]; let divisions=1, beats=4, beatType=4, fifths=0, mi=0;
  for(const m of arr(p.measure)){
   if(m.attributes?.divisions) divisions=Number(m.attributes.divisions)||divisions;
   if(m.attributes?.time){beats=Number(m.attributes.time.beats)||beats;beatType=Number(m.attributes.time['beat-type'])||beatType;}
   if(m.attributes?.key?.fifths!=null) fifths=Number(m.attributes.key.fifths)||0;
   const nominalQ=beats*(4/beatType);
   measureMeta[mi]={beats,beatType,fifths,nominalQ};
   let cursor=0,lastStart=0;
   for(const n of arr(m.note)){
    const durDiv=Number(n.duration||0),dur=durDiv/divisions,v=String(n.voice||'1'); voices.add(v);
    const start=n.chord!==undefined?lastStart:cursor; if(n.chord===undefined)lastStart=start;
    if(n.pitch){
      const step=String(n.pitch.step),alt=Number(n.pitch.alter||0),oct=Number(n.pitch.octave),midi=(oct+1)*12+stepSemi[step]+alt;
      const beams=arr(n.beam).map(b=>typeof b==='object'?{number:Number(b['@_number']||1),value:String(b['#text']||'')}:{number:1,value:String(b)}).filter(b=>b.value);
      events.push({voice:v,midi,step,alter:alt,octave:oct,measure:mi,start,dur:Math.max(dur,.0625),type:String(n.type||''),dot:n.dot!==undefined,beams,sourceStaff:Number(n.staff||0)||0,isRest:false});
    } else if(n.rest!==undefined && dur>0){
      events.push({voice:v,isRest:true,measure:mi,start,dur,type:String(n.type||''),dot:n.dot!==undefined,sourceStaff:Number(n.staff||0)||0,measureRest:typeof n.rest==='object'&&String(n.rest?.['@_measure']||'')==='yes'});
    }
    if(n.chord===undefined)cursor+=dur;
   }
   mi++;
  }
  globalMeasures=Math.max(globalMeasures,mi);
  parts.push({id:String(p['@_id']),name:names[p['@_id']]||String(p['@_id']),voices:[...voices].sort(),events,meta:{beats,beatType,fifths,measures:mi,measureMeta}});
 }
 return {kind:'musicxml',parts,measures:globalMeasures,metadata:{title,subtitle,collection:source||rights,composer:cleanComposer,dates:dateMatch}};
}
function parseMidi(buf){const m=new Midi(buf);let max=0;const parts=m.tracks.map((t,i)=>({id:String(i),name:t.name||`Track ${i+1}`,voices:[`ch ${t.channel+1}`],events:t.notes.map(n=>{const s=n.ticks/m.header.ppq,d=n.durationTicks/m.header.ppq;max=Math.max(max,s+d);const pc=n.midi%12,oct=Math.floor(n.midi/12)-1,steps=['C','C','D','D','E','F','F','G','G','A','A','B'],alts=[0,1,0,1,0,0,1,0,1,0,1,0];return{voice:`ch ${t.channel+1}`,midi:n.midi,step:steps[pc],alter:alts[pc],octave:oct,measure:Math.floor(s/4),start:s%4,dur:d,type:''}}),meta:{beats:4,beatType:4,fifths:0,measures:Math.ceil(max/4)}}));return{kind:'midi',parts,measures:Math.ceil(max/4)}}
async function parseMXL(buf){const zip=await JSZip.loadAsync(buf);let rootPath='';const ce=zip.file('META-INF/container.xml');if(ce){const c=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'}).parse(await ce.async('string'));const roots=arr(c?.container?.rootfiles?.rootfile);rootPath=roots.find(r=>String(r?.['@_media-type']||'').includes('musicxml'))?.['@_full-path']||roots[0]?.['@_full-path']||'';}if(!rootPath)rootPath=Object.keys(zip.files).find(n=>!zip.files[n].dir&&/\.(musicxml|xml)$/i.test(n)&&!/^META-INF\//i.test(n))||'';if(!rootPath||!zip.file(rootPath))throw Error('This .mxl archive does not contain a readable MusicXML score.');return parseXML(await zip.file(rootPath).async('nodebuffer'));}
app.post('/api/import',upload.single('score'),async(req,res)=>{try{if(!req.file)throw Error('Choose a score file first.');const b=req.file.buffer,n=req.file.originalname.toLowerCase(),zip=b.length>=4&&b[0]===0x50&&b[1]===0x4b,midi=b.subarray(0,4).toString('ascii')==='MThd',head=b.subarray(0,512).toString('utf8').replace(/^\uFEFF/,'').trimStart(),xml=head.startsWith('<?xml')||head.startsWith('<score-partwise');let parsed;if(midi)parsed=parseMidi(b);else if(zip)parsed=await parseMXL(b);else if(xml)parsed=parseXML(b);else if(/\.midi?$/.test(n))parsed=parseMidi(b);else if(/\.(mxl|musicxml|xml)$/.test(n))parsed=parseXML(b);else throw Error('Unsupported score file.');res.json(parsed);}catch(e){res.status(400).json({error:e.message})}});

function selectedStreams(parts,selected){const streams=[];let v=1,order=0;for(const p of parts)for(const voice of p.voices){const key=`${p.id}|${voice}`;if(selected.includes(key))streams.push({voiceNo:v++,order:order++,name:`${p.name} · ${voice}`,events:p.events.filter(e=>e.voice===voice)});}return streams;}
function typeFor(q){if(q>=4)return 'whole';if(q>=2)return 'half';if(q>=1)return 'quarter';if(q>=.5)return 'eighth';if(q>=.25)return '16th';return '32nd';}
function beamXML(beams=[]){return beams.map(b=>`<beam number="${Number(b.number||1)}">${esc(b.value)}</beam>`).join('');}
function noteXML(e,voiceNo,div,chord=false,stem='',beams=[]){const d=Math.max(1,Math.round(e.dur*div)),staff=e.midi>=60?1:2;return `<note>${chord?'<chord/>':''}<pitch><step>${esc(e.step)}</step>${e.alter?`<alter>${e.alter}</alter>`:''}<octave>${e.octave}</octave></pitch><duration>${d}</duration><voice>${voiceNo}</voice><type>${typeFor(e.dur)}</type>${e.dot?'<dot/>':''}${stem?`<stem>${stem}</stem>`:''}${beamXML(beams)}<staff>${staff}</staff></note>`;}
function restSpec(q){
 const vals=[
  [4,'whole',0],[3,'half',1],[2,'half',0],[1.5,'quarter',1],[1,'quarter',0],
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
 return {beats,beatType,nominalQ,targetQ:shortEdge?sourceEnd:nominalQ};
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
 return {...e,...pitchFieldsFromMidi(midi),intelligentOctaveShift:midi-Number(e.midi)};
}

function makeIntelligentReduction(parts,selected,meta={},intelligence={}){
 // Canonical rule: literal import owns rhythm. Intelligent mode may only change engraving
 // ownership (staff/voice/stem/chord). Pitch, onset and duration are immutable.
 const streams=selectedStreams(parts,selected);if(!streams.length)throw Error('Select at least one voice.');
 const canonical=canonicalNoteSignature(streams);
 const first=parts.find(p=>selected.some(k=>k.startsWith(`${p.id}|`)))||parts[0],fifths=Number(first?.meta?.fifths||0),div=480,maxM=Math.max(0,...streams.flatMap(s=>s.events.map(e=>e.measure||0)));
 let measures='', emittedSignature=[];
 for(let m=0;m<=maxM;m++){
  const timing=measureTiming(first,streams,m,maxM),beats=timing.beats,beatType=timing.beatType,targetQ=timing.targetQ;
  let body='',voiceCounter=0;
  const stems=stemAssignments(streams,m);
  const literal=!!intelligence.literal;
  // Outer pitch bounds are measured from the unmodified source texture for this measure.
  // They are anchors/guards only; Literal mode never calls the octave normalizer.
  const sourceNotes=streams.flatMap(st=>st.events.filter(e=>(e.measure||0)===m&&!e.isRest));
  const bassSource=sourceNotes.filter(e=>(e.sourceStaff||(e.midi>=60?1:2))===2).map(e=>Number(e.midi));
  const trebleSource=sourceNotes.filter(e=>(e.sourceStaff||(e.midi>=60?1:2))===1).map(e=>Number(e.midi));
  const octaveRange={lowBass:bassSource.length?Math.min(...bassSource):NaN,highTreble:trebleSource.length?Math.max(...trebleSource):NaN};

  // First make true simultaneous chord groups. A chord is legal only when onset, duration,
  // staff, stem-role and beam state agree. Exact duplicate pitches are de-duplicated visually
  // but still represented in the validation signature below.
  const chordGroups=new Map();
  for(const st of streams) for(const sourceEvent of st.events.filter(e=>(e.measure||0)===m&&!e.isRest)){
   assertEventFits(sourceEvent,targetQ,m,st.name);
   const staff=sourceEvent.sourceStaff||(sourceEvent.midi>=60?1:2),stem=stems.get(`${st.voiceNo}|${m}|${sourceEvent.start}`)||'';
   const e=literal?{...sourceEvent}:intelligentOctaveNormalize(sourceEvent,staff,octaveRange);
   if(!e)continue;
   // Hard invariant: octave normalization may alter/omit pitch only. It may not move or resize a note.
   if(Number(e.start)!==Number(sourceEvent.start)||Number(e.dur)!==Number(sourceEvent.dur)||Number(e.measure||0)!==Number(sourceEvent.measure||0))throw Error('Intelligent octave normalization changed rhythmic placement.');
   emittedSignature.push([m,Number(e.start||0).toFixed(6),Number(e.dur||0).toFixed(6),Number(e.midi),String(e.step||''),Number(e.alter||0),Number(e.octave||0)].join('|'));
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
   const owner=literal?(hasBeam?`src${st.voiceNo}`:(role||`src${st.voiceNo}`)):(role||`src${st.voiceNo}`);
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
   const literal=!!intelligence.literal;
   // In intelligent mode, up/down are persistent engraving layers. Prefer the matching
   // layer first, then any free layer. Only create an additional lane when independent
   // durations genuinely overlap and therefore cannot legally share a MusicXML voice.
   lane=lanes.find(l=>l.owner===g.owner && l.end<=g.start+.000001);
   if(!lane && !literal && (g.owner==='up'||g.owner==='down')){
     lane=lanes.find(l=>l.role===g.owner && l.end<=g.start+.000001);
   }
   if(!lane) lane=lanes.find(l=>l.end<=g.start+.000001 && (literal?!(g.beams||[]).length:true));
   if(!lane){lane={staff:g.staff,owner:g.owner,role:(g.owner==='up'||g.owner==='down')?g.owner:'',end:0,events:[]};lanes.push(lane);}
   if(!lane.role && (g.owner==='up'||g.owner==='down'))lane.role=g.owner;
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
