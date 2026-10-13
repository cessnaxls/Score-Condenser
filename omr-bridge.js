import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
export async function symbolEvidence(buffer){
 const dir=await mkdtemp(join(tmpdir(),'score-omr-'));const file=join(dir,'score.png');
 try{
  await writeFile(file,buffer,{mode:0o600});
  return await new Promise((resolve,reject)=>{
   const p=spawn('python3',['omr_engine.py',file],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let output='',error='',done=false;
   const timeout=setTimeout(()=>p.kill('SIGKILL'),35000);
   p.stdout.on('data',b=>{output+=b;if(output.length>15_000_000)p.kill('SIGKILL')});
   p.stderr.on('data',b=>error=(error+b).slice(-1000));
   p.on('error',e=>{if(done)return;done=true;clearTimeout(timeout);reject(e)});
   p.on('close',code=>{if(done)return;done=true;clearTimeout(timeout);try{if(code!==0)throw Error(error||'OMR recognition failed');resolve(JSON.parse(output))}catch(e){reject(e)}});
  });
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
