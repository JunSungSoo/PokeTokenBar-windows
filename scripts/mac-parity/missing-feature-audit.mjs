// Reproduce audit gaps using disposable files; never read or modify user credentials/saves.
import{mkdtemp,rm,mkdir,writeFile,readFile,readdir}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';
import{CompanionStore}from'../../dist/main/companion/store.js';
const dir=await mkdtemp(join(tmpdir(),'ptb-missing-audit-')),results={reference:'origin/feature/battle',commit:'ad1bb7c9217028270ec28ebfb8d2dc05059a09da'};
try{
 const path=join(dir,'companion-v1.json'),store=new CompanionStore(path,()=>false);
 await store.update(new Map(),1800000000000);await store.createSnapshot();
 const [snapshot]=await store.snapshots(),progress=await store.snapshotProgress(snapshot.id);
 await writeFile(path,'{"version":');
 results.corruptSave={validSnapshots:(await store.snapshots()).length};
 try{await new CompanionStore(path).read();results.corruptSave.startup='recovered';}catch(error){results.corruptSave.startup='rejected: '+error.name;}
 try{await store.replaceImport(progress,1800000000001);results.corruptSave.restore='restored';}catch(error){results.corruptSave.restore='rejected: '+error.name;}
 const original=(await readdir(dir)).find(name=>name.includes('.corrupt-'));results.corruptSave.originalPreserved=!!original&&(await readFile(join(dir,original),'utf8'))==='{"version":';
 const root=join(dir,'.claude-team');await mkdir(root);await writeFile(join(root,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'fixture@example.invalid',organizationName:'Fixture'}}));await writeFile(join(root,'.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'fixture-only-not-a-real-key',expiresAt:1900000000000}}));
 const module=new URL('../../dist/main/usage/claude-accounts.js',import.meta.url).href;
 const code=`import{homedir}from'node:os';import{claudeAccountSources}from ${JSON.stringify(module)};console.log(JSON.stringify({home:homedir(),auto:await claudeAccountSources([]),manual:await claudeAccountSources([${JSON.stringify(root)}])}));`;
 const account=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,USERPROFILE:dir,CLAUDE_CONFIG_DIR:''}}));
 if(account.home.toLowerCase()!==dir.toLowerCase())throw Error('Home isolation failed');
 results.accountDiscovery={autoFoundTeam:account.auto.some(row=>row.roots.includes(root)),manualFoundTeam:account.manual.some(row=>row.roots.includes(root))};
 const reportDirectory=new URL('../../output/mac-parity/',import.meta.url);
 await mkdir(reportDirectory,{recursive:true});
 await writeFile(new URL('missing-feature-samples.json',reportDirectory),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
}finally{await rm(dir,{recursive:true,force:true});}
