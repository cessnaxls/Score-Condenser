import {mkdtemp,writeFile,readdir,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const MAX_PDF_BYTES=20*1024*1024;
const MAX_OCR_OUTPUT=512*1024;
const MAX_MXL_BYTES=30*1024*1024;
const OMR_TIMEOUT_MS=Number(process.env.OMR_TIMEOUT_MS)||240000;

export function pdfEngineStatus(){return {configured:process.env.AUDIVERIS_BIN||'audiveris',pdfEnabled:true,reviewRequired:true};}

async function execute(binary,args,timeout){
 return new Promise((resolve,reject)=>{
  let settled=false,log='';const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,JAVA_TOOL_OPTIONS:[process.env.JAVA_TOOL_OPTIONS||'','-Djava.awt.headless=true'].join(' ').trim()}});
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result)};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('PDF recognition timed out. Try fewer pages, or a higher-memory Render instance.'))},timeout);
  for(const out of [child.stdout,child.stderr])out.on('data',c=>{log=(log+c.toString()).slice(-MAX_OCR_OUTPUT)});
  child.on('error',e=>finish(Error('Audiveris is unavailable: '+e.message+'. Install it or set AUDIVERIS_BIN.')));
  child.on('close',code=>code===0?finish(null,log):finish(Error('Audiveris recognition failed (exit '+code+'). '+log.slice(-1800))));
 });
}
async function locateScore(folder){
 const hits=[];
 async function walk(p,depth){if(depth>3)return;for(const ent of await readdir(p,{withFileTypes:true})){const full=path.join(p,ent.name);if(ent.isDirectory())await walk(full,depth+1);else if(/\.(mxl|musicxml|xml)$/i.test(ent.name)&&!ent.name.startsWith('.'))hits.push(full)}}
 await walk(folder,0);hits.sort((a,b)=>Number(/\.mxl$/i.test(b))-Number(/\.mxl$/i.test(a)));return hits;
}
export async function recognizePDF(buffer,{parseXML,parseMXL}){
 if(!Buffer.isBuffer(buffer)||buffer.length<8||buffer.subarray(0,5).toString('latin1')!=='%PDF-')throw Error('This is not a valid PDF header.');
 if(buffer.length>MAX_PDF_BYTES)throw Error('PDF exceeds 20 MB limit.');
 const folder=await mkdtemp(path.join(tmpdir(),'score-omr-'));
 try{
  const filename=path.join(folder,'source.pdf'),output=path.join(folder,'output');
  await writeFile(filename,buffer,{mode:0o600});
  await execute(process.env.AUDIVERIS_BIN||'audiveris',['-batch','-transcribe','-export','-output',output,'--',filename],OMR_TIMEOUT_MS);
  const scores=await locateScore(output).catch(()=>[]);
  if(!scores.length)throw Error('PDF recognition finished without a MusicXML score. Use a sharp, upright scan with visible staff lines.');
  if(scores.length>1)throw Error('PDF contains multiple movements exported as separate scores. Import each MusicXML movement individually (the combined PDF cannot be merged safely).');
  const file=scores[0],info=await stat(file);
  if(info.size>MAX_MXL_BYTES)throw Error('Recognized score is too large.');
  const data=await readFile(file);
  const parsed=/\.mxl$/i.test(file)?await parseMXL(data):parseXML(data);
  const warnings=[
   'Optical music recognition is not a ground-truth transcription. Check every pitch, rhythmic value, key, accidental, voice and measure against the source PDF.',
   'The accuracy audit verifies only that condensation preserved the recognized MusicXML notes; it cannot validate the OMR recognition against the PDF.'
  ];
  parsed.recognition={source:'pdf-omr',engine:'Audiveris',reviewRequired:true,warnings,recognizedParts:parsed.parts.length,recognizedMeasures:parsed.measures};
  return parsed;
 }finally{await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}
