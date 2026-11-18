import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

export const macReference=resolve(process.env.POKE_MAC_REFERENCE??'../PokeTokenBar');
export const macReferenceRef=process.env.POKE_MAC_REFERENCE_REF??'origin/feature/battle';
export const hasMacReference=existsSync(join(macReference,'AGENTS.md'));
// Read the selected branch without changing the user's Mac checkout.
export function readMacSource(path){
 return execFileSync('git',['-C',macReference,'show',macReferenceRef+':'+path],{encoding:'utf8',maxBuffer:16*1024*1024});
}
export function macSourceBlobs(paths,reference=macReference){
 const rows=execFileSync('git',['-C',reference,'ls-tree','-r','-z',macReferenceRef,'--',...paths],{encoding:'utf8',maxBuffer:16*1024*1024});
 return new Map(rows.split('\0').filter(Boolean).map(row=>{const [metadata,path]=row.split('\t');return[path,metadata.split(' ')[2]];}));
}
