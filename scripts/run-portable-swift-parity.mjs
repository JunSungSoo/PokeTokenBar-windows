// Run inside scripts/swift-parity.Dockerfile after preparing the selected Mac reference.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const reference=resolve('output/mac-parity/reference');
const env={...process.env,POKE_MAC_REFERENCE:process.env.POKE_MAC_REFERENCE??reference,POKE_MAC_RESOURCE_REFERENCE:reference};
for(const [kind,key]of [['details','DETAILS'],['profile','PROFILE'],['loadout','LOADOUT'],['tooltip','TOOLTIP'],['runtime','RUNTIME'],['battle','BATTLE']]){
 const output=resolve('output/mac-parity',kind);
 execFileSync(process.execPath,['scripts/build-mac-'+kind+'-oracle.mjs',reference,output],{stdio:'inherit'});
 env['POKE_MAC_'+key+'_ORACLE']=join(output,'oracle');
}
if(process.argv.includes('--full')){
 const {scripts}=JSON.parse(await readFile('package.json','utf8'));
 const tests=scripts.test.split('node --test ')[1].trim().split(/\s+/);
 execFileSync(process.execPath,['--test',...tests],{stdio:'inherit',env});
}else{
 execFileSync(process.execPath,['--test','tests/pokemon-details.test.mjs','tests/runtime.test.mjs'],{stdio:'inherit',env});
 execFileSync(process.execPath,['--test','--test-name-pattern=commitment hashes match','tests/battle-lan.test.mjs'],{stdio:'inherit',env});
}
