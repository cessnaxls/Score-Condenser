import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

const app=express();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
app.use(express.json({limit:'20mb'})); app.use(express.static('public'));
app.get('/health',(_,r)=>r.json({ok:true}));
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
const stepSemi={C:0,D:2,E:4,F:5,G:7,A:9,B:11};

function parseXML(buf){
 const x=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,preserveOrder:false}).parse(buf.toString());
 const score=x['score-partwise']; if(!score) throw Error('This app expects a MusicXML score-partwise document.');
 const names={}; for(const p of arr(score['part-list']?.['score-part'])) names[p['@_id']]=String(p['part-name']||p['@_id']);
 const parts=[]; let globalMeasures=0;
 for(const p of arr(score.part)){
  const voices=new Set(), events=[]; let divisions=1, beats=4, beatType=4, fifths=0; let mi=0;
  for(const m of arr(p.measure)){
   if(m.attributes?.divisions) divisions=Number(m.attributes.divisions)||divisions;
   if(m.attributes?.time){beats=Number(m.attributes.time.beats)||beats;beatType=Number(m.attributes.time['beat-type'])||beatType;}
   if(m.attributes?.key?.fifths!=null) fifths=Number(m.attributes.key.fifths)||0;
   let cursor=0, lastStart=0; const items=[];
   // fast-xml-parser loses exact interleaving of backup/forward with note in object mode for complex files.
   // Most exported polyphonic parts use explicit voices; preserve note durations and chord starts here.
   for(const n of arr(m.note)){
    const durDiv=Number(n.duration||0); const dur=durDiv/divisions; const v=String(n.voice||'1'); voices.add(v);
    const start=n.chord!==undefined?lastStart:cursor; if(n.chord===undefined) lastStart=start;
    if(n.pitch){const step=String(n.pitch.step),alt=Number(n.pitch.alter||0),oct=Number(n.pitch.octave);const midi=(oct+1)*12+stepSemi[step]+alt;events.push({voice:v,midi,step,alter:alt,octave:oct,measure:mi,start,dur:Math.max(dur,.125),type:String(n.type||''),dot:n.dot!==undefined,tie:arr(n.tie).map(t=>t?.['@_type']).filter(Boolean)});}
    if(n.chord===undefined) cursor+=dur;
   }
   mi++;
  }
  globalMeasures=Math.max(globalMeasures,mi);
  parts.push({id:String(p['@_id']),name:names[p['@_id']]||String(p['@_id']),voices:[...voices].sort(),events,meta:{divisions,beats,beatType,fifths,measures:mi}});
 }
 return {kind:'musicxml',parts,measures:globalMeasures};
}
function parseMidi(buf){const m=new Midi(buf);let max=0;const parts=m.tracks.map((t,i)=>({id:String(i),name:t.name||`Track ${i+1}`,voices:[`ch ${t.channel+1}`],events:t.notes.map(n=>{const s=n.ticks/m.header.ppq,d=n.durationTicks/m.header.ppq;max=Math.max(max,s+d);return{voice:`ch ${t.channel+1}`,midi:n.midi,measure:Math.floor(s/4),start:s%4,dur:d,type:''}}),meta:{beats:4,beatType:4,fifths:0,measures:Math.ceil(max/4)}}));return{kind:'midi',parts,measures:Math.ceil(max/4)}}
async function parseMXL(buf){const zip=await JSZip.loadAsync(buf);let rootPath='';const ce=zip.file('META-INF/container.xml');if(ce){const c=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'}).parse(await ce.async('string'));const roots=arr(c?.container?.rootfiles?.rootfile);rootPath=roots.find(r=>String(r?.['@_media-type']||'').includes('musicxml'))?.['@_full-path']||roots[0]?.['@_full-path']||'';}if(!rootPath)rootPath=Object.keys(zip.files).find(n=>!zip.files[n].dir&&/\.(musicxml|xml)$/i.test(n)&&!/^META-INF\//i.test(n))||'';if(!rootPath||!zip.file(rootPath))throw Error('This .mxl archive does not contain a readable MusicXML score.');return parseXML(await zip.file(rootPath).async('nodebuffer'));}
app.post('/api/import',upload.single('score'),async(req,res)=>{try{if(!req.file)throw Error('Choose a score file first.');const b=req.file.buffer,n=req.file.originalname.toLowerCase();const zip=b.length>=4&&b[0]===0x50&&b[1]===0x4b;const midi=b.subarray(0,4).toString('ascii')==='MThd';const head=b.subarray(0,512).toString('utf8').replace(/^\uFEFF/,'').trimStart();const xml=head.startsWith('<?xml')||head.startsWith('<score-partwise');let parsed;if(midi)parsed=parseMidi(b);else if(zip)parsed=await parseMXL(b);else if(xml)parsed=parseXML(b);else if(/\.midi?$/.test(n))parsed=parseMidi(b);else if(/\.(mxl|musicxml|xml)$/.test(n))parsed=parseXML(b);else throw Error('Unsupported score file.');res.json(parsed);}catch(e){res.status(400).json({error:e.message})}});

function pitchY(midi,staffTop,treble){
 // Diatonic staff placement; middle C = 60. Treble bottom line E4=64, bass top line A3=57.
 const pcStep=[0,0,1,1,2,3,3,4,4,5,5,6]; const oct=Math.floor(midi/12)-1, pc=midi%12; const dia=oct*7+pcStep[pc];
 const ref=treble?(4*7+2):(3*7+5); // E4 bottom treble / A3 top bass
 return treble ? staffTop+32-(dia-ref)*4 : staffTop+(dia-ref)*-4;
}
function staff(doc,x,y,w,clef){doc.save().lineWidth(.55).strokeColor('#111');for(let i=0;i<5;i++)doc.moveTo(x,y+i*8).lineTo(x+w,y+i*8).stroke();doc.font('Times-Roman').fillColor('#111').fontSize(clef==='G'?28:24).text(clef==='G'?'G':'F',x+2,y-8,{lineBreak:false});doc.restore();}
function ledger(doc,x,y,staffTop){for(let ly=staffTop-8;ly>=y-1;ly-=8)doc.moveTo(x-6,ly).lineTo(x+7,ly).stroke();for(let ly=staffTop+40;ly<=y+1;ly+=8)doc.moveTo(x-6,ly).lineTo(x+7,ly).stroke();}
function note(doc,x,y,dur,alter,staffTop){doc.save().fillColor('#111').strokeColor('#111').lineWidth(1);ledger(doc,x,y,staffTop);doc.ellipse(x,y,4.7,3.3);if(dur<2)doc.fill();else doc.stroke();if(dur<4){const up=y>staffTop+16;const sx=up?x+4:x-4;doc.moveTo(sx,y).lineTo(sx,up?y-25:y+25).stroke();if(dur<=.5){const sy=up?y-25:y+25;doc.moveTo(sx,sy).bezierCurveTo(sx+8,sy+(up?5:-5),sx+8,sy+(up?13:-13),sx+2,sy+(up?17:-17)).stroke();}}if(alter){doc.font('Times-Roman').fontSize(12).text(alter>0?'#':'b',x-14,y-7,{lineBreak:false});}doc.restore();}
function drawRest(doc,x,y,dur){doc.save().fillColor('#111').strokeColor('#111');if(dur>=4)doc.rect(x-5,y,10,3).fill();else if(dur>=2)doc.rect(x-5,y-3,10,3).fill();else{doc.font('Times-Bold').fontSize(16).text(dur<=.5?'𝄾':'𝄽',x-5,y-10,{lineBreak:false});}doc.restore();}
function buildSelected(parts,selected){const out=[];for(const p of parts)for(const e of p.events)if(selected.includes(`${p.id}|${e.voice}`))out.push({...e,source:p.name,key:`${p.id}|${e.voice}`});return out;}
app.post('/api/pdf',(req,res)=>{try{const {parts,selected,meta={}}=req.body;if(!selected?.length)throw Error('Select at least one voice.');const ev=buildSelected(parts,selected);if(!ev.length)throw Error('No notes were found in the selected voices.');const maxMeasure=Math.max(...ev.map(e=>e.measure||0));const first=parts.find(p=>selected.some(k=>k.startsWith(`${p.id}|`)))||parts[0];const beats=Number(first?.meta?.beats||4),beatType=Number(first?.meta?.beatType||4);const doc=new PDFDocument({size:'LETTER',margins:{top:45,bottom:45,left:45,right:45},bufferPages:true});const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>{res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="condensed-keyboard-score.pdf"');res.end(Buffer.concat(chunks));});
 doc.font('Times-Bold').fontSize(22).text(meta.title||'Untitled',{align:'center'});if(meta.collection)doc.font('Times-Italic').fontSize(10).text(meta.collection,{align:'center'});doc.moveDown(.2);if(meta.composer||meta.dates)doc.font('Times-Roman').fontSize(10).text([meta.composer,meta.dates].filter(Boolean).join('  '),{align:'right'});doc.moveDown(.8);
 const left=50,right=562,sysW=right-left,measuresPerSystem=4,mw=sysW/measuresPerSystem;let y=doc.y+8;const systemH=112;
 for(let base=0;base<=maxMeasure;base+=measuresPerSystem){if(y+systemH>735){doc.addPage();y=55;}const treble=y,bass=y+58;staff(doc,left,treble,sysW,'G');staff(doc,left,bass,sysW,'F');doc.font('Times-Roman').fontSize(9).text(`${beats}/${beatType}`,left+22,treble+6,{lineBreak:false});doc.text(`${beats}/${beatType}`,left+22,bass+6,{lineBreak:false});
  for(let j=0;j<measuresPerSystem;j++){const m=base+j;if(m>maxMeasure)break;const mx=left+j*mw;doc.strokeColor('#111').lineWidth(.7).moveTo(mx,treble).lineTo(mx,treble+32).stroke().moveTo(mx,bass).lineTo(mx,bass+32).stroke();doc.font('Helvetica').fontSize(6).fillColor('#555').text(String(m+1),mx+3,treble-11,{lineBreak:false});const notes=ev.filter(e=>(e.measure||0)===m);const grouped=new Map();for(const n of notes){const k=`${n.start}|${n.midi}`;if(!grouped.has(k))grouped.set(k,n);}for(const n of grouped.values()){const frac=Math.max(0,Math.min(.995,Number(n.start||0)/beats));const nx=mx+31+frac*(mw-36);const tr=n.midi>=60;const sy=tr?treble:bass;const ny=pitchY(n.midi,sy,tr);note(doc,nx,ny,Number(n.dur||1),Number(n.alter||0),sy);}}
  const endx=left+Math.min(measuresPerSystem,maxMeasure-base+1)*mw;doc.moveTo(endx,treble).lineTo(endx,treble+32).stroke().moveTo(endx,bass).lineTo(endx,bass+32).stroke();y+=systemH;
 }
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(7).fillColor('#777').text(`${meta.title||'Untitled'}  ·  ${i+1}/${range.count}`,45,755,{width:522,align:'center'});}doc.end();
}catch(e){res.status(400).json({error:e.message})}});
app.listen(process.env.PORT||3000,()=>console.log('Score Condensor running'));
