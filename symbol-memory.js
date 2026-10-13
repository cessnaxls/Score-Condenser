import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// Persist on a Render disk in production; a local folder is only for development.
const root=process.env.OMR_MEMORY_DIR||path.join(process.cwd(),'data','omr-memory');
const storeFile=path.join(root,'symbols.json');
const allowed=new Set(['notehead-filled','notehead-hollow','whole','breve','longa','clef-g','clef-f','clef-c','sharp','flat','natural','double-sharp','double-flat','rest','dot','tie','slur','barline','repeat','flag','other']);
let items=[];let ready;
async function init(){await mkdir(root,{recursive:true});try{const x=JSON.parse(await readFile(storeFile,'utf8'));if(Array.isArray(x))items=x.filter(y=>y&&y.id&&y.hash&&allowed.has(y.label));}catch(e){if(e.code!=='ENOENT')throw e;}}
async function ensure(){if(!ready)ready=init();await ready;}
async function persist(){const tmp=storeFile+'.'+crypto.randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(items),{mode:0o600});await rename(tmp,storeFile);}
let writer=Promise.resolve();function serialize(fn){const current=writer.then(fn);writer=current.catch(()=>{});return current;}
function hamming(a,b){let n=0;for(let i=0;i<a.length;i++){let c=parseInt(a[i],16)^parseInt(b[i],16);while(c){n++;c&=c-1;}}return n;}
export async function fingerprint(buffer){if(!Buffer.isBuffer(buffer)||buffer.length>3*1024*1024||buffer.length<80)throw Error('Provide a cropped PNG/JPEG/WebP under 3 MB.');
 const {data,info}=await sharp(buffer,{limitInputPixels:15e6}).flatten({background:'#ffffff'}).greyscale().resize(9,8,{fit:'fill'}).raw().toBuffer({resolveWithObject:true});
 let bits='';for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits+=data[y*info.width+x]<data[y*info.width+x+1]?'1':'0';
 return BigInt('0b'+bits).toString(16).padStart(16,'0');}
export async function listSymbols(){await ensure();return items.map(({id,label,description,context,createdAt})=>({id,label,description,context,createdAt}));}
export async function matchSymbol(buffer,limit=5){await ensure();const hash=await fingerprint(buffer);const found=items.map(({id,label,description,context,hash:stored})=>({id,label,description,context,distance:hamming(hash,stored)})).sort((a,b)=>a.distance-b.distance).slice(0,limit);
 // A perceptual match is NOT proof that a symbol has the same musical meaning.
 return {matches:found.map(x=>({...x,similarity:Math.round(100*(1-x.distance/64)),requiresConfirmation:true})),autoApplied:false};}
export async function trainSymbol({buffer,label,description='',context=''}){await ensure();if(!allowed.has(label))throw Error('Unsupported symbol label');if(items.length>=10000)throw Error('Training library full');
 if(String(description).length>240||String(context).length>240)throw Error('Description too long');const hash=await fingerprint(buffer);
 return serialize(async()=>{const existing=items.find(x=>x.hash===hash&&x.label===label);if(existing)return {id:existing.id,duplicate:true};
 const entry={id:crypto.randomUUID(),label,description:String(description).trim(),context:String(context).trim(),hash,createdAt:new Date().toISOString()};items.push(entry);await persist();return {id:entry.id,duplicate:false};});}
export async function deleteSymbol(id){await ensure();return serialize(async()=>{const old=items.length;items=items.filter(x=>x.id!==id);if(old===items.length)return false;await persist();return true;});}
export const symbolLabels=[...allowed];
