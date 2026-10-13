/** GPT-powered visual score transcription, with no Audiveris dependency. */
import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const MAX_IMAGES=8;
const MAX_FILE_SIZE=20*1024*1024;
const allowedPhoto=/\.(png|jpe?g|webp)$/i;
export function pdfEngineStatus(){return {engine:'OpenAI vision',configured:!!process.env.OPENAI_API_KEY,pdfEnabled:true,photosEnabled:true,maxPages:MAX_IMAGES,reviewRequired:true};}
const instruction=`You are an expert professional sheet-music transcriptionist, including Renaissance music and mensural notation. Read EACH supplied page/photo in given order and transcribe its printed musical notes as literally as possible. Return ONLY a valid JSON object with keys "musicxml" (string, complete MusicXML 4.0 score-partwise document), "uncertainties" (array of specific strings describing ambiguous measures or symbols). Preserve all distinct parts/staves, voices, rests, clefs, key signatures, time signatures, accidentals, octaves, onset positions, note durations, dotted notes, chords, ties, measure numbering and source title. Never invent missing notes or quietly regularize meter; preserve unusual or overfull measures exactly. For square noteheads identify breve (double whole) as <type>breve</type> and longa as <type>long</type>; they are NOT quarter/whole notes. Use MusicXML divisions=10080 per quarter and <duration>20160</duration> for breve, <duration>40320</duration> for longa when appropriate; if the glyph is ambiguous say so in uncertainties. Preserve duration-time using <backup>/<forward> to represent parallel voices correctly. If a note cannot be read, add an explicit uncertainty with page/staff/measure and do NOT guess confidently. Each part should have matching measure boundaries. Never simplify, condense, transpose, or reinterpret the harmony. Return score-partwise XML, not markdown.`;

async function pdfToPngs(data){
 const dir=await mkdtemp(path.join(tmpdir(),'gpt-score-'));
 try {
  const pdf=path.join(dir,'source.pdf');await writeFile(pdf,data,{mode:0o600});
  await new Promise((resolve,reject)=>{
   const child=spawn('pdftoppm',['-f','1','-l',String(MAX_IMAGES+1),'-scale-to','1800','-png',pdf,path.join(dir,'page')],{stdio:['ignore','ignore','pipe']});
   let err='';const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
   child.stderr.on('data',v=>err=(err+v.toString()).slice(-1000));
   child.on('error',e=>{clearTimeout(timer);reject(Error('PDF renderer unavailable: '+e.message))});
   child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Could not render PDF: '+err))});
  });
  const names=(await readdir(dir)).filter(n=>/^page-\d+\.png$/i.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(!names.length)throw Error('No readable PDF pages.');
  if(names.length>MAX_IMAGES)throw Error('PDF has more than 8 pages. Split it into batches of at most 8 pages.');
  return Promise.all(names.map(n=>readFile(path.join(dir,n))));
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
function mimeOf(f){const name=String(f.originalname||'');if(/\.png$/i.test(name))return'image/png';if(/\.webp$/i.test(name))return'image/webp';return'image/jpeg'}
function validPhoto(f){const b=f.buffer;const mime=mimeOf(f);return mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'}
export async function recognizeImages(files,{parseXML}){
 if(!process.env.OPENAI_API_KEY)throw Error('Online GPT transcription is not configured. Set OPENAI_API_KEY on Render.');
 if(!Array.isArray(files)||!files.length||files.length>MAX_IMAGES)throw Error('Choose between 1 and 8 ordered pages/photos.');
 const images=[];
 for(const f of files){
  if(!f.buffer?.length||f.buffer.length>MAX_FILE_SIZE)throw Error('File is empty or exceeds 20MB.');
  if(/\.pdf$/i.test(f.originalname)||f.buffer.subarray(0,5).toString()==='%PDF-'){
   if(f.buffer.subarray(0,5).toString()!=='%PDF-')throw Error('PDF header is invalid.');
   const pages=await pdfToPngs(f.buffer);for(const b of pages)images.push({mime:'image/png',data:b});
  }else{
   if(!allowedPhoto.test(f.originalname)||!validPhoto(f))throw Error('Supported photo formats: PNG, JPEG, WEBP.');
   images.push({mime:mimeOf(f),data:f.buffer});
  }
  if(images.length>MAX_IMAGES)throw Error('Maximum 8 pages/photos per transcription.');
 }
 const content=[{type:'text',text:`Transcribe these ${images.length} score page(s) in precisely this order. Square breve and longa notation MUST be distinguished. Return a complete score-partwise MusicXML, and list uncertainties.`},...images.map((im,i)=>({type:'image_url',image_url:{url:`data:${im.mime};base64,${im.data.toString('base64')}`,detail:'high'}}))];
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),240000);
 let response;
 try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_OMR_MODEL||'gpt-4.1',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:instruction},{role:'user',content}],max_completion_tokens:16000})});}
 catch(e){throw Error('Online transcription connection failed or timed out: '+e.message)}finally{clearTimeout(timer)}
 const reply=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Online GPT transcription failed: '+(reply.error?.message||`HTTP ${response.status}`));
 const text=reply.choices?.[0]?.message?.content;
 if(typeof text!=='string')throw Error('GPT did not return a text transcription.');
 let result;try{result=JSON.parse(text)}catch{throw Error('GPT returned invalid transcription JSON. Retry with fewer pages.');}
 const xml=String(result.musicxml||'').trim();
 if(!xml.includes('<score-partwise')||!xml.includes('</score-partwise>'))throw Error('GPT did not produce a complete MusicXML score.');
 const parsed=parseXML(Buffer.from(xml));
 if(!parsed.parts.length||!parsed.parts.some(p=>p.events.some(e=>!e.isRest)))throw Error('No pitched notes recognized.');
 const uncertainties=Array.isArray(result.uncertainties)?result.uncertainties.map(x=>String(x)).slice(0,100):[];
 parsed.recognition={source:'gpt-vision-omr',engine:process.env.OPENAI_OMR_MODEL||'gpt-4.1',reviewRequired:true,uncertainties,recognizedPages:images.length,warnings:['GPT transcription is NOT verified against the image. Manually compare pitches, clefs, notes, breve/longa glyphs and rhythms against each original page.','The automatic condensation audit only checks preservation of the recognized notes, not the accuracy of image transcription.']};
 parsed.recognizedMusicXML=xml;
 return parsed;
}
