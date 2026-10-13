/** Linewise GPT optical music transcription. No Audiveris. Every image/system remains unverified until human proofread. */
import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import sharp from 'sharp';
import {XMLParser,XMLBuilder} from 'fast-xml-parser';

const MAX_PAGES=8,MAX_BYTES=20*1024*1024,MAX_SYSTEMS=48;
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false});
const builder=new XMLBuilder({ignoreAttributes:false,attributeNamePrefix:'@_',format:true,suppressEmptyNode:false});
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
export function pdfEngineStatus(){return {engine:'OpenAI vision · linewise',configured:!!process.env.OPENAI_API_KEY,pdfEnabled:true,photosEnabled:true,maxPages:MAX_PAGES,reviewRequired:true,method:'system crops with source-preserving MusicXML and structured diagnostics'};}
const systemInstruction=`You are transcribing one cropped HORIZONTAL MUSICAL SYSTEM from a printed score. Be a rigorous music copyist, not a composer. Transcribe EVERY visible musical symbol per staff and voice, reading LEFT-TO-RIGHT one measure at a time. Preserve the number and vertical order of staves/parts, clefs (including movable Renaissance C clefs), key signatures, mensuration/time signatures, accidentals, note spellings and octaves, chords, stems, rests, dots, ties, barlines, and note durations. Do not normalize historical notation, fill in imagined notes, change meter, transpose, or condense. Distinguish square breves (MusicXML type breve) and longae (MusicXML type long) from whole notes using the shape of the notehead. Beware of square rests, ligatures, early staff clefs and mensural notation; report ambiguity. Preserve lyric syllables under the correct notes if legible. Use backup/forward for simultaneous MusicXML voices. You may return fewer measures than expected ONLY if the crop is visibly incomplete, and must then report the missing region. The input is a single score system, not an entire page. Return a JSON object with EXACT keys: musicxml (complete MusicXML score-partwise with one part per visible staff and matching measures), uncertainties (array of concise references STAFF and local MEASURE and what is unreadable), staffCount (integer), measureCount (integer). Every part MUST appear in the part-list AND part body, even for multimeasure rests. Use divisions 10080; a breve lasting 8 quarter beats uses duration 80640, a longa lasting 16 quarter beats uses duration 161280 only in standard modern proportional interpretation; historical mensural values depend on context and must be flagged when uncertain. Do not invent a total measure count; include only measures actually shown. Return JSON, no prose or markdown.`;
function isPDF(b){return b.subarray(0,5).toString('ascii')==='%PDF-'}
async function pdfPngs(data){
 const dir=await mkdtemp(path.join(tmpdir(),'linewise-omr-'));
 try{
  const pdf=path.join(dir,'source.pdf');await writeFile(pdf,data,{mode:0o600});
  await new Promise((resolve,reject)=>{
   const child=spawn('pdftoppm',['-f','1','-l',String(MAX_PAGES+1),'-r','240','-png',pdf,path.join(dir,'page')],{stdio:['ignore','ignore','pipe']});
   let err='',done=false;const timeout=setTimeout(()=>child.kill('SIGKILL'),120000);
   child.stderr.on('data',d=>err=(err+d.toString()).slice(-600));
   child.on('error',e=>{if(done)return;done=true;clearTimeout(timeout);reject(Error('PDF renderer unavailable: '+e.message))});
   child.on('close',code=>{if(done)return;done=true;clearTimeout(timeout);code===0?resolve():reject(Error('PDF rendering failed: '+err))});
  });
  const names=(await readdir(dir)).filter(n=>/^page-\d+\.png$/i.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(names.length>MAX_PAGES)throw Error('PDF exceeds 8 pages; split into smaller documents.');
  return Promise.all(names.map(n=>readFile(path.join(dir,n))));
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
function photoMime(f){const name=f.originalname||'';return /\.png$/i.test(name)?'image/png':/\.webp$/i.test(name)?'image/webp':'image/jpeg';}
function validImage(f){const b=f.buffer||Buffer.alloc(0);if(/\.png$/i.test(f.originalname))return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(/\.jpe?g$/i.test(f.originalname))return b[0]===255&&b[1]===216&&b[2]===255;if(/\.webp$/i.test(f.originalname))return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';return false;}
/** Detect staff lines by full-width dark-pixel projections, group staves into systems. Never crop a staff to improve recognition. */
async function sliceSystems(buffer,pageNumber){
 const probe=sharp(buffer,{limitInputPixels:160000000}).rotate();
 const metadata=await probe.metadata();let width=metadata.width,height=metadata.height;
 if(!width||!height)throw Error('Cannot determine page image dimensions.');
 const scanW=Math.min(width,1100),scanH=Math.round(height*scanW/width);
 const raw=await probe.clone().resize(scanW,scanH,{fit:'fill'}).greyscale().raw().toBuffer();
 const rowInk=[];const left=Math.round(scanW*.06),right=Math.round(scanW*.95),span=right-left;
 for(let y=0;y<scanH;y++){
  let dark=0;for(let x=left;x<right;x++){if(raw[y*scanW+x]<165)dark++;}
  rowInk.push(dark/span);
 }
 // Staff ruling lines cover a large horizontal fraction; exclude text and notes.
 const lines=[];let active=false,from=0;
 for(let y=0;y<scanH;y++){
  const on=rowInk[y]>=.37;
  if(on&&!active){active=true;from=y;}if(!on&&active){lines.push(Math.round((from+y-1)/2));active=false;}
 }if(active)lines.push(Math.round((from+scanH-1)/2));
 const spacings=lines.slice(1).map((x,i)=>x-lines[i]).filter(x=>x>=3&&x<=22).sort((a,b)=>a-b);
 const dist=spacings.length?spacings[Math.floor(spacings.length/2)]:0;
 if(lines.length<10||!dist)return [{data:buffer,page:pageNumber,system:1,warning:'Staff-line segmentation could not be established; read as whole page'}];
 // Adjacent staves in one system can be relatively far apart; the vertical gap between systems is normally much larger.
 const staffRuns=[];let run=[lines[0]];
 for(const y of lines.slice(1)){if(y-run[run.length-1]<=dist*2.3)run.push(y);else{if(run.length>=4)staffRuns.push(run);run=[y];}}
 if(run.length>=4)staffRuns.push(run);
 if(staffRuns.length<2)return [{data:buffer,page:pageNumber,system:1,warning:'System segmentation uncertain; using complete page'}];
 const groups=[];let g=[staffRuns[0]];
 for(const s of staffRuns.slice(1)){
  const prev=g[g.length-1],gap=s[0]-prev[prev.length-1];
  if(gap>Math.max(dist*11,45)){groups.push(g);g=[s];}else g.push(s);
 }groups.push(g);
 if(groups.length<2||groups.length>12)return [{data:buffer,page:pageNumber,system:1,warning:'Detected staff grouping was inconclusive; using complete page'}];
 const bounds=groups.map((group,i)=>{
  const first=group[0][0],last=group[group.length-1].at(-1);
  const previous=i?groups[i-1].at(-1).at(-1):0,next=i<groups.length-1?groups[i+1][0][0]:scanH;
  return [Math.max(0,Math.round((i?(first+previous)/2:Math.max(0,first-dist*12)))),Math.min(scanH,Math.round(i<groups.length-1?(last+next)/2:Math.min(scanH,last+dist*12)))];
 });
 const images=[];
 for(let i=0;i<bounds.length;i++){
  const [a,b]=bounds[i],top=Math.max(0,Math.floor(a*height/scanH)),bottom=Math.min(height,Math.ceil(b*height/scanH));
  const crop=await sharp(buffer).rotate().extract({left:0,top,width,height:bottom-top}).png().toBuffer();
  images.push({data:crop,page:pageNumber,system:i+1,staffCount:groups[i].length,warning:null});
 }
 return images;
}
async function queryGPT(image,system,previous){
 const userText=`Transcribe page ${system.page}, system ${system.system}, with ${system.staffCount||'unknown'} staff group(s). Preserve ALL visible notes of this system. ${previous?'The prior system had '+previous+' staves: maintain part order and identities.':''} Report unreadable markings specifically. Do not hallucinate.`;
 const request={model:process.env.OPENAI_OMR_MODEL||'gpt-4.1',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:systemInstruction},{role:'user',content:[{type:'text',text:userText},{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64'),detail:'high'}}]}],max_completion_tokens:16000};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(process.env.OMR_CALL_TIMEOUT_MS)||180000);
 let response;
 try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(request)});}
 catch(e){throw Error(`GPT transcription page ${system.page}, system ${system.system} failed: ${e.message}`)}finally{clearTimeout(timer)}
 const answer=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(`GPT returned an error on page ${system.page}, system ${system.system}: ${answer.error?.message||response.status}`);
 if(answer.choices?.[0]?.finish_reason==='length')throw Error(`GPT truncated page ${system.page}, system ${system.system}; retry with a clearer crop`);
 let obj;try{obj=JSON.parse(answer.choices?.[0]?.message?.content||'');}catch{throw Error(`Invalid GPT response on page ${system.page}, system ${system.system}`)}
 if(typeof obj.musicxml!=='string')throw Error('GPT omitted MusicXML on page '+system.page+' system '+system.system);
 const doc=parser.parse(obj.musicxml.replace(/^```(?:xml)?\s*/,'').replace(/```\s*$/,''));
 if(!doc['score-partwise'])throw Error(`GPT did not return score-partwise MusicXML at page ${system.page}, system ${system.system}`);
 return {doc:doc['score-partwise'],uncertainties:arr(obj.uncertainties).map(String),staffCount:Number(obj.staffCount)||null,measureCount:Number(obj.measureCount)||null};
}
function mergeSystems(results){
 const first=results[0].transcription.doc;
 const baseParts=arr(first.part);
 if(!baseParts.length)throw Error('GPT returned no parts on the first system.');
 const partCount=baseParts.length;let measureNumber=0;
 const merged=baseParts.map((p,i)=>({'@_id':`P${i+1}`,measure:[]}));
 const issues=[],regions=[];
 for(const item of results){
  const current=arr(item.transcription.doc.part),mCount=Math.max(...current.map(p=>arr(p.measure).length),0);
  if(current.length!==partCount){issues.push(`Page ${item.page} system ${item.system}: expected ${partCount} parts, GPT returned ${current.length}. Import cannot safely join the systems.`);continue;}
  if(!mCount){issues.push(`Page ${item.page} system ${item.system}: no measures transcribed.`);continue;}
  for(let i=0;i<partCount;i++){
   const measures=arr(current[i].measure);
   if(measures.length!==mCount)issues.push(`Page ${item.page} system ${item.system}, staff ${i+1}: ${measures.length} measures vs ${mCount} in another staff.`);
  }
  if(issues.length)continue;
  for(let i=0;i<partCount;i++)for(const [j,m] of arr(current[i].measure).entries())merged[i].measure.push({...m,'@_number':String(measureNumber+j+1)});
  regions.push({page:item.page,system:item.system,measureStart:measureNumber+1,measureEnd:measureNumber+mCount,staffCount:partCount,uncertainties:item.transcription.uncertainties});
  measureNumber+=mCount;
 }
 if(issues.length)throw Error('Ambiguous staff/measure structure; not silently joining incorrect music: '+issues.slice(0,3).join(' '));
 const partList=arr(first['part-list']?.['score-part']);
 const named=merged.map((p,i)=>({'@_id':p['@_id'],'part-name':partList[i]?.['part-name']||`Staff ${i+1}`}));
 const xmlDoc={'score-partwise':{'@_version':'4.0','work':first.work,'movement-title':first['movement-title'],identification:first.identification,'part-list':{'score-part':named},part:merged}};
 const xml='<?xml version="1.0" encoding="utf-8"?>\n'+builder.build(xmlDoc);
 return {xml,regions,partCount,measureCount:measureNumber};
}
export async function recognizeImages(files,{parseXML}){
 if(!process.env.OPENAI_API_KEY)throw Error('Set OPENAI_API_KEY in Render to use GPT sheet-music transcription.');
 if(!files.length||files.length>MAX_PAGES)throw Error('Choose 1–8 ordered PDF pages or photographs.');
 const pages=[];
 for(const f of files){
  if(!f.buffer?.length||f.buffer.length>MAX_BYTES)throw Error('An input file is empty or exceeds 20 MB.');
  if(isPDF(f.buffer))pages.push(...(await pdfPngs(f.buffer)));
  else {if(!validImage(f))throw Error('Only valid PNG, JPEG, WebP photos and PDF pages are supported.');pages.push(f.buffer);}
  if(pages.length>MAX_PAGES)throw Error('At most eight pages/photos per job.');
 }
 const systems=[];
 for(let i=0;i<pages.length;i++)systems.push(...await sliceSystems(pages[i],i+1));
 if(systems.length>MAX_SYSTEMS)throw Error('Too many score systems to verify in one job; split the document.');
 const results=[],warnings=[];let precedingParts=null;
 for(const system of systems){
  if(system.warning)warnings.push(`Page ${system.page}: ${system.warning}`);
  const transcription=await queryGPT(system.data,system,precedingParts);
  const count=arr(transcription.doc.part).length;
  if(precedingParts!==null&&precedingParts!==count)throw Error(`Staff count changes on page ${system.page} system ${system.system} (${precedingParts} vs ${count}). Review this system manually; automatic alignment is unsafe.`);
  precedingParts=count;
  results.push({...system,transcription,data:undefined});
 }
 const merged=mergeSystems(results),parsed=parseXML(Buffer.from(merged.xml));
 const pitched=parsed.parts.flatMap(p=>p.events).filter(e=>!e.isRest).length;
 if(!pitched)throw Error('No pitched musical notes were recognized.');
 const uncertainties=results.flatMap(item=>item.transcription.uncertainties.map(s=>`Page ${item.page}, system ${item.system}: ${s}`));
 parsed.recognition={source:'gpt-vision-linewise',engine:process.env.OPENAI_OMR_MODEL||'gpt-4.1',reviewRequired:true,uncertainties:uncertainties.slice(0,300),warnings:[...warnings,'Optical transcription has not been independently proven note-for-note; proofread EACH staff and measure against the source before relying on the result.','The condensation audit verifies recognized data, not whether the AI recognized the printed notes correctly.'],recognizedPages:pages.length,recognizedSystems:systems.length,regions:merged.regions,recognizedNoteCount:pitched};
 parsed.recognizedMusicXML=merged.xml;
 return parsed;
}
