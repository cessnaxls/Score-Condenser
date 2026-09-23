import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;
import JSZip from 'jszip';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
app.use(express.json({limit:'25mb'})); app.use(express.static('public'));
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
  const voices=new Set(), events=[]; let divisions=1, beats=4, beatType=4, fifths=0, mi=0;
  for(const m of arr(p.measure)){
   if(m.attributes?.divisions) divisions=Number(m.attributes.divisions)||divisions;
   if(m.attributes?.time){beats=Number(m.attributes.time.beats)||beats;beatType=Number(m.attributes.time['beat-type'])||beatType;}
   if(m.attributes?.key?.fifths!=null) fifths=Number(m.attributes.key.fifths)||0;
   let cursor=0,lastStart=0;
   for(const n of arr(m.note)){
    const durDiv=Number(n.duration||0),dur=durDiv/divisions,v=String(n.voice||'1'); voices.add(v);
    const start=n.chord!==undefined?lastStart:cursor; if(n.chord===undefined)lastStart=start;
    if(n.pitch){
      const step=String(n.pitch.step),alt=Number(n.pitch.alter||0),oct=Number(n.pitch.octave),midi=(oct+1)*12+stepSemi[step]+alt;
      const beams=arr(n.beam).map(b=>typeof b==='object'?{number:Number(b['@_number']||1),value:String(b['#text']||'')}:{number:1,value:String(b)}).filter(b=>b.value);
      events.push({voice:v,midi,step,alter:alt,octave:oct,measure:mi,start,dur:Math.max(dur,.0625),type:String(n.type||''),dot:n.dot!==undefined,beams});
    }
    if(n.chord===undefined)cursor+=dur;
   }
   mi++;
  }
  globalMeasures=Math.max(globalMeasures,mi);
  parts.push({id:String(p['@_id']),name:names[p['@_id']]||String(p['@_id']),voices:[...voices].sort(),events,meta:{beats,beatType,fifths,measures:mi}});
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
function restXML(q,voiceNo,div,staff){if(q<=.0001)return '';return `<note><rest/><duration>${Math.max(1,Math.round(q*div))}</duration><voice>${voiceNo}</voice><type>${typeFor(q)}</type><staff>${staff}</staff></note>`;}
function stemAssignments(streams,m){
 const map=new Map(),groups=new Map();
 for(const s of streams) for(const e of s.events.filter(e=>(e.measure||0)===m)){
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
 const out=new Map(); const beatQ=4/beatType;
 // Preserve explicit source beams whenever present.
 es.forEach((e,i)=>{if(e.beams?.length)out.set(i,e.beams)});
 let i=0;
 while(i<es.length){
   if(es[i].dur>.5||out.has(i)){i++;continue}
   const boundary=Math.floor((es[i].start+1e-6)/beatQ)*beatQ+beatQ;let j=i+1;
   while(j<es.length && es[j].dur<=.5 && !out.has(j) && es[j].start<boundary-1e-6 && Math.abs((es[j-1].start+es[j-1].dur)-es[j].start)<.001)j++;
   if(j-i>=2){for(let k=i;k<j;k++)out.set(k,[{number:1,value:k===i?'begin':k===j-1?'end':'continue'}]);}
   i=Math.max(j,i+1);
 }
 return out;
}
function makeReduction(parts,selected,meta={}){
 const streams=selectedStreams(parts,selected);if(!streams.length)throw Error('Select at least one voice.');
 const first=parts.find(p=>selected.some(k=>k.startsWith(`${p.id}|`)))||parts[0],beats=Number(first?.meta?.beats||4),beatType=Number(first?.meta?.beatType||4),fifths=Number(first?.meta?.fifths||0),measureQ=beats*(4/beatType),div=480,maxM=Math.max(0,...streams.flatMap(s=>s.events.map(e=>e.measure||0)));
 let measures='';
 for(let m=0;m<=maxM;m++){
  let body=''; const stems=stemAssignments(streams,m);
  for(let si=0;si<streams.length;si++){
   const s=streams[si],es=s.events.filter(e=>(e.measure||0)===m).sort((a,b)=>a.start-b.start||a.midi-b.midi);const beamMap=generatedBeams(es,beats,beatType);let cursor=0,i=0,lastStaff=si%2?2:1;
   while(i<es.length){const start=Number(es[i].start||0);if(start>cursor+.0001)body+=restXML(start-cursor,s.voiceNo,div,lastStaff);const group=[];while(i<es.length&&Math.abs(Number(es[i].start||0)-start)<.0001)group.push(es[i++]);group.sort((a,b)=>a.midi-b.midi);group.forEach((e,j)=>{lastStaff=e.midi>=60?1:2;const stem=stems.get(`${s.voiceNo}|${m}|${e.start}`)||'';const idx=es.indexOf(e);body+=noteXML(e,s.voiceNo,div,j>0,stem,beamMap.get(idx)||[])});cursor=Math.max(cursor,start+Math.max(...group.map(e=>Number(e.dur||0))));}
   if(cursor<measureQ-.0001)body+=restXML(measureQ-cursor,s.voiceNo,div,lastStaff);
   if(si<streams.length-1)body+=`<backup><duration>${Math.round(measureQ*div)}</duration></backup>`;
  }
  const attrs=m===0?`<attributes><divisions>${div}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves><part-symbol>brace</part-symbol><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`:'';
  measures+=`<measure number="${m+1}">${attrs}${body}</measure>`;
 }
 return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="4.0"><work><work-title>${esc(meta.title||'Untitled')}</work-title></work>${meta.subtitle?`<movement-title>${esc(meta.subtitle)}</movement-title>`:''}<identification><creator type="composer">${esc([meta.composer,meta.dates].filter(Boolean).join(' '))}</creator>${meta.collection?`<source>${esc(meta.collection)}</source>`:''}</identification><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

let toolkitPromise;
async function getToolkit(){if(!toolkitPromise)toolkitPromise=createVerovioModule().then(m=>new VerovioToolkit(m));return toolkitPromise;}
app.post('/api/engrave',async(req,res)=>{try{const {parts,selected,meta={},layout={}}=req.body;const xml=makeReduction(parts,selected,meta);const tk=await getToolkit();const landscape=layout.orientation==='landscape',base=layout.pageSize==='a4'?{w:2100,h:2970}:{w:2159,h:2794},w=landscape?base.h:base.w,h=landscape?base.w:base.h,scale=Number(layout.scale||42),spacing=Number(layout.noteSpacing||1),stretch=Number(layout.barStretch||1),staff=Number(layout.staffSpacing||12),system=Number(layout.systemSpacing||10),margin=Number(layout.margin||60);tk.setOptions({pageWidth:w,pageHeight:h,pageMarginTop:margin,pageMarginBottom:margin,pageMarginLeft:margin,pageMarginRight:margin,scale,breaks:'auto',header:'auto',footer:'none',font:'Leipzig',spacingLinear:.25*spacing*stretch,spacingNonLinear:.6*spacing,spacingStaff:staff,spacingSystem:system,justifyVertically:true,systemDivider:'none'});tk.loadData(xml);const pages=[];for(let i=1;i<=tk.getPageCount();i++)pages.push(tk.renderToSVG(i,{}));res.json({pages,musicxml:xml,pageCount:pages.length});}catch(e){console.error(e);res.status(400).json({error:e.message})}});
app.listen(process.env.PORT||3000,()=>console.log('Score Condensor running with Verovio engraving'));
