import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import { Midi } from '@tonejs/midi';
import PDFDocument from 'pdfkit';

const app=express(); const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
app.use(express.json({limit:'5mb'})); app.use(express.static('public'));
app.get('/health',(_,r)=>r.json({ok:true}));
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
function parseXML(buf){
 const x=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false}).parse(buf.toString());
 const score=x['score-partwise']; if(!score) throw Error('This app currently expects MusicXML score-partwise files.');
 const names={}; for(const p of arr(score['part-list']?.['score-part'])) names[p['@_id']]=p['part-name']||p['@_id'];
 const parts=[]; for(const p of arr(score.part)){
  const voices=new Set(); const events=[]; let divisions=1, time=0;
  for(const m of arr(p.measure)){
   if(m.attributes?.divisions) divisions=Number(m.attributes.divisions)||divisions;
   for(const n of arr(m.note)){
    const dur=Number(n.duration||0)/divisions; const v=String(n.voice||'1'); voices.add(v);
    if(n.pitch){ const step=n.pitch.step, alt=Number(n.pitch.alter||0), oct=Number(n.pitch.octave); const semi={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step]+alt; const midi=(oct+1)*12+semi; events.push({voice:v,midi,start:time,dur:Math.max(dur,.125)}); }
    if(!n.chord) time+=dur;
   }
  }
  parts.push({id:p['@_id'],name:names[p['@_id']]||p['@_id'],voices:[...voices].sort(),events});
 }
 return {kind:'musicxml',parts};
}
function parseMidi(buf){ const m=new Midi(buf); return {kind:'midi',parts:m.tracks.map((t,i)=>({id:String(i),name:t.name||`Track ${i+1}`,voices:[`ch ${t.channel+1}`],events:t.notes.map(n=>({voice:`ch ${t.channel+1}`,midi:n.midi,start:n.ticks/m.header.ppq,dur:n.durationTicks/m.header.ppq}))}))}; }
app.post('/api/import',upload.single('score'),(req,res)=>{try{const n=req.file.originalname.toLowerCase(); res.json(n.endsWith('.mid')||n.endsWith('.midi')?parseMidi(req.file.buffer):parseXML(req.file.buffer));}catch(e){res.status(400).json({error:e.message})}});
function noteName(m){const pc=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][m%12];return pc+(Math.floor(m/12)-1)}
function buildCondensed(parts,selected){const ev=[]; for(const p of parts) for(const e of p.events) if(selected.includes(`${p.id}|${e.voice}`)) ev.push({...e,part:p.name}); ev.sort((a,b)=>a.start-b.start||b.midi-a.midi); return ev;}
app.post('/api/pdf',(req,res)=>{try{const {parts,selected,meta={}}=req.body; const ev=buildCondensed(parts,selected); const doc=new PDFDocument({size:'LETTER',margins:{top:54,bottom:54,left:54,right:54}}); const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('end',()=>{res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="condensed-score.pdf"');res.end(Buffer.concat(chunks));});
 doc.font('Times-Bold').fontSize(22).text(meta.title||'Untitled',{align:'center'}); if(meta.collection) doc.font('Times-Roman').fontSize(11).text(meta.collection,{align:'center'}); doc.moveDown(.3); doc.font('Times-Italic').fontSize(11).text([meta.composer,meta.dates].filter(Boolean).join('  '),{align:'right'}); doc.moveDown();
 doc.font('Helvetica').fontSize(10).text('CONDENSED KEYBOARD SCORE',{characterSpacing:1}); doc.moveDown(.5);
 const groups=new Map(); for(const e of ev){const k=e.start.toFixed(3); if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e)}
 let y=doc.y; const pageW=504; const x0=54; const rowH=74;
 for(const [beat,notes] of groups){ if(y+rowH>720){doc.addPage();y=60;} doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Beat ${Number(beat)+1}`,x0,y); y+=12; doc.fillColor('#000').font('Times-Roman').fontSize(12).text('𝄞  '+notes.filter(n=>n.midi>=60).map(n=>noteName(n.midi)).join('   '),x0,y,{width:pageW}); y+=22; doc.moveTo(x0,y).lineTo(x0+pageW,y).strokeColor('#bbb').stroke(); y+=8; doc.fillColor('#000').text('𝄢  '+notes.filter(n=>n.midi<60).map(n=>noteName(n.midi)).join('   '),x0,y,{width:pageW}); y+=30; }
 doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666').text('Pitch split: C4 (middle C) and above → treble; B3 and below → bass.',54,740,{align:'center',width:504}); doc.end();
 }catch(e){res.status(400).json({error:e.message})}});
const port=process.env.PORT||3000; app.listen(port,()=>console.log(`Score Condensor on ${port}`));
