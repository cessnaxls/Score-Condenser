let score=null,lastXML='',lastPages=[],lastPreviewLayout=null,timer=null,auditDecisions={};const $=s=>document.querySelector(s),file=$('#file'),parts=$('#parts');
async function waitForImport(jobId){
 for(;;){
  await new Promise(resolve=>setTimeout(resolve,2500));
  const r=await fetch('/api/import-jobs/'+encodeURIComponent(jobId),{cache:'no-store'});
  const j=await r.json().catch(()=>({error:'Cannot read import status'}));
  if(!r.ok)throw Error(j.error||'Unable to check import status');
  $('#importStatus').textContent=j.message||j.state;
  if(j.state==='complete')return j.result;
  if(j.state==='failed')throw Error(j.error||'Music recognition failed');
 }
}
file.onchange=async()=>{
 if(!file.files.length)return;
 if(file.files.length>8){alert('Select at most eight photos/pages at once.');return;}
 $('#work').classList.add('hidden');$('#previewPanel').classList.add('hidden');
 const status=$('#importStatus');status.textContent='Uploading '+file.files.length+' file(s)…';
 file.disabled=true;
 const fd=new FormData();for(const f of file.files)fd.append('score',f);
 try{
  const r=await fetch('/api/import',{method:'POST',body:fd});const j=await r.json().catch(()=>({error:'Server returned an invalid response. Check the Render logs.'}));
  if(!r.ok)throw Error(j.error||'Import failed ('+r.status+')');
  const imported=j.jobId?await waitForImport(j.jobId):j;
  score=imported;auditDecisions={};$('#pdfRecognition').classList.toggle('hidden',!score.recognition?.reviewRequired);$('#confirmOmr').checked=false;
  prefillMetadata(score.metadata||{});render();
  if(score.recognition){const x=score.recognition;$('#analysisStatus').textContent=`Recognized ${x.recognizedPages||'?'} page(s), ${x.recognizedSystems||'?'} system(s), ${x.recognizedNoteCount||'?'} pitched note entries. ${x.uncertainties?.length||0} flagged uncertainties. ALL measures require visual proofreading.`+(x.uncertainties?.length?' Details: '+x.uncertainties.join(' | '):'');}
  $('#work').classList.remove('hidden');status.textContent='Imported successfully: '+score.parts.length+' part(s).';
 }catch(e){status.textContent='Import failed: '+e.message;alert(e.message)}finally{file.disabled=false;file.value='';}
};

function prefillMetadata(m){$('#title').value=m.title||'';$('#subtitle').value=m.subtitle||'';$('#collection').value=m.collection||'';$('#composer').value=m.composer||'';$('#dates').value=m.dates||'';}
function render(){parts.innerHTML='';score.parts.forEach(p=>{const d=document.createElement('div'),partNotes=p.events.filter(e=>!e.isRest).length;d.className='part';d.innerHTML=`<div class="partTitle">${esc(p.name)} <small>· ${partNotes} notes</small></div>`;p.voices.forEach(v=>{const ev=p.events.filter(e=>e.voice===v),n=ev.filter(e=>!e.isRest).length,r=ev.filter(e=>e.isRest).length,row=document.createElement('div');row.className='voice';row.innerHTML=`<input class="pick" type="checkbox" checked data-key="${esc(p.id)}|${esc(v)}"><div><b>${p.voices.length===1?'Part':'Voice '+esc(v)}</b><br><small>${n} notes${r?` · ${r} rests`:''}</small></div><button class="solo">Solo</button><button class="mute">Mute</button>`;row.querySelector('.solo').onclick=()=>{document.querySelectorAll('.pick').forEach(x=>x.checked=false);row.querySelector('.pick').checked=true;schedulePreview()};row.querySelector('.mute').onclick=()=>{row.querySelector('.pick').checked=false;schedulePreview()};row.querySelector('.pick').onchange=schedulePreview;d.appendChild(row)});parts.appendChild(d)})}
$('#all').onclick=()=>{document.querySelectorAll('.pick').forEach(x=>x.checked=true);schedulePreview()};
function payload(){return{parts:score.parts,selected:[...document.querySelectorAll('.pick:checked')].map(x=>x.dataset.key),meta:{title:$('#title').value,subtitle:$('#subtitle').value,collection:$('#collection').value,composer:$('#composer').value,dates:$('#dates').value},transcription:{intelligent:false,octaveTranscription:false,transposeSemitones:0},layout:{pageSize:$('#pageSize').value,orientation:$('#orientation').value,scale:+$('#scale').value,noteSpacing:+$('#noteSpacing').value/100,barStretch:+$('#barStretch').value/100,staffSpacing:+$('#staffSpacing').value,systemSpacing:+$('#systemSpacing').value,margin:+$('#margin').value,autoFit:$('#autoFit').checked}}}
async function engrave(){if(!score)return;if(score.recognition?.reviewRequired&&!$('#confirmOmr').checked){alert('Please acknowledge the PDF recognition review requirement first.');return;}const body=payload();if(!body.selected.length)return alert('Select at least one voice.');$('#status').textContent='Engraving…';$('#previewPanel').classList.remove('hidden');$('#pages').classList.add('busy');try{const r=await fetch('/api/engrave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw Error(j.error);lastXML=j.musicxml;auditDecisions={};$('#auditSummary').textContent='Preview changed. Run the audit to verify this version.';$('#auditIssues').innerHTML='';lastPages=j.pages;lastPreviewLayout=j.layout||body.layout;$('#pages').innerHTML=j.pages.map((s,i)=>`<article class="scorePage" data-page="${i+1}">${s}</article>`).join('');$('#status').textContent=`Preview ready · ${j.pageCount} page${j.pageCount===1?'':'s'}`+(score.recognition?.reviewRequired?' · PDF recognition UNVERIFIED':'');$('#previewPanel').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){$('#status').textContent=e.message}finally{$('#pages').classList.remove('busy')}}
$('#preview').onclick=engrave;
function schedulePreview(){if($('#previewPanel').classList.contains('hidden'))return;clearTimeout(timer);timer=setTimeout(engrave,350)}
['title','subtitle','collection','composer','dates'].forEach(id=>$('#'+id).addEventListener('change',schedulePreview));
const controls={scale:v=>v,noteSpacing:v=>(v/100).toFixed(2)+'×',barStretch:v=>(v/100).toFixed(2)+'×',staffSpacing:v=>v,systemSpacing:v=>v,margin:v=>v};Object.entries(controls).forEach(([id,fmt])=>{$('#'+id).oninput=()=>{$('#'+id+'Out').value=fmt(+$('#'+id).value);schedulePreview()}});$('#autoFit').onchange=schedulePreview;['pageSize','orientation'].forEach(id=>$('#'+id).onchange=schedulePreview);
$('#musicxml').onclick=()=>{if(!lastXML)return;const u=URL.createObjectURL(new Blob([lastXML],{type:'application/vnd.recordare.musicxml+xml'})),a=document.createElement('a');a.href=u;a.download='keyboard-reduction.musicxml';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
function previewSvgToPng(svg){return new Promise((resolve,reject)=>{try{
 const m=svg.match(/viewBox=["']\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/i);if(!m)throw Error('Preview page has no page geometry.');
 const sourceW=Math.max(1,+m[3]),sourceH=Math.max(1,+m[4]);
 // iPad/Safari can return the unusable string "data:," when a canvas exceeds its backing-store
 // limit. Rasterize the complete page at a bounded print resolution instead of trusting the SVG
 // viewBox as a literal canvas size. This remains a full-page PNG, not SVG-in-PDF.
 const maxSide=4096,maxPixels=12000000,sideScale=Math.min(1,maxSide/Math.max(sourceW,sourceH)),pixelScale=Math.min(1,Math.sqrt(maxPixels/(sourceW*sourceH))),scale=Math.min(sideScale,pixelScale);
 const w=Math.max(1,Math.round(sourceW*scale)),h=Math.max(1,Math.round(sourceH*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('This browser could not create the PDF page canvas.');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),img=new Image();
 img.onload=()=>{ctx.drawImage(img,0,0,w,h);URL.revokeObjectURL(url);canvas.toBlob(async pngBlob=>{try{if(!pngBlob||pngBlob.type!=='image/png')throw Error('Browser PNG rasterization failed.');const bytes=new Uint8Array(await pngBlob.arrayBuffer());const sig=[137,80,78,71,13,10,26,10];if(bytes.length<8||sig.some((v,i)=>bytes[i]!==v))throw Error('Browser returned invalid PNG data.');let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));resolve({mime:'image/png',base64:btoa(binary),width:w,height:h})}catch(e){reject(e)}},'image/png',1)};
 img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Could not rasterize the displayed preview page.'))};img.src=url
 }catch(e){reject(e)}})}
$('#print').onclick=async()=>{if(!score)return;const body=payload();if(!body.selected.length)return alert('Select at least one voice.');if(!lastPages.length)return alert('Preview the score first.');const btn=$('#print'),old=btn.textContent;btn.disabled=true;btn.textContent='Printing preview…';try{const pngPages=[];for(const svg of lastPages)pngPages.push(await previewSvgToPng(svg));const r=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pages:pngPages,layout:lastPreviewLayout||body.layout,title:body.meta.title})});if(!r.ok){let msg='PDF generation failed';try{msg=(await r.json()).error||msg}catch{}throw Error(msg)}const blob=await r.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=((body.meta.title||'keyboard-reduction').replace(/[^a-z0-9._-]+/gi,'-')||'keyboard-reduction')+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000)}catch(e){alert(e.message)}finally{btn.disabled=false;btn.textContent=old}};
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function downloadConverted(endpoint,filename){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload(),xml:lastXML})});if(!r.ok){let j={};try{j=await r.json()}catch{}throw Error(j.error||'Export failed');}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
$('#mxl').onclick=async()=>{try{await downloadConverted('/api/export-mxl','keyboard-reduction.mxl')}catch(e){alert(e.message)}};
$('#midi').onclick=async()=>{try{await downloadConverted('/api/export-midi','keyboard-reduction.mid')}catch(e){alert(e.message)}};

function auditPayload(){const p=payload();return {...p,xml:lastXML,transposeSemitones:p.transcription.transposeSemitones,intelligent:p.transcription.intelligent,octaveTranscription:p.transcription.octaveTranscription};}
function displayAudit(report){const summary=report.summary;$('#auditSummary').textContent=`${summary.expected} source notes · ${summary.output} output notes · ${summary.errors} errors · ${summary.warnings} warnings${summary.verified?' · VERIFIED':' · Export blocked'}`;if(score?.recognition?.reviewRequired)$('#auditSummary').textContent+=' · PDF note recognition NOT verified';const holder=$('#auditIssues');holder.innerHTML='';for(const issue of report.issues){const row=document.createElement('div');row.className='auditIssue auditError';row.innerHTML=`<div><b>Measure ${issue.measure} · ${esc(issue.kind)}</b></div><p>${esc(issue.description)}</p><small>Source data is read-only. Repair the original score and import it again.</small>`;holder.append(row)}if(!report.issues.length)holder.textContent='All selected pitched-note occurrences preserved with matching onset, duration and written pitch.';}
$('#runAudit').onclick=async()=>{if(!lastXML)return alert('Preview the score first.');const btn=$('#runAudit');btn.disabled=true;btn.textContent='Auditing…';try{const r=await fetch('/api/audit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(auditPayload())}),j=await r.json();if(!r.ok)throw Error(j.error);auditDecisions={};displayAudit(j);}catch(e){$('#auditSummary').textContent='Audit failed: '+e.message;}finally{btn.disabled=false;btn.textContent='Audit output';}};
