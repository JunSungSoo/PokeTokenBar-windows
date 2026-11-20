import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hasMacReference,readMacSource,macReferenceRef} from './mac-reference.mjs';
import {paceFraction,paceTier,gaugeTier,roundedPaceDelta,forecastDepletion,forecast,activeBlock,accountOwner,accountBlocks,quotaPresentation,hpLevel} from '../dist/shared/quota-presentation.js';
import {parseLimits} from '../dist/main/usage/limits.js';
import {withAccountBlocks} from '../dist/main/usage/claude-accounts.js';
import {nationalDex} from '../dist/main/companion/national-dex.js';
import {hatchData} from '../dist/main/companion/hatch-data.js';
import {speciesFor} from '../dist/main/companion/catalog.js';

const now=1800000000000, span=18000;
test('pace window, rounding, gauge and remaining marker match Mac boundary samples',()=>{
 for(const [seconds,expected] of [[18000,0],[9000,.5],[4500,.75],[0,1],[-1,null],[18001,null]])assert.equal(paceFraction(now+seconds*1000,span,now),expected);
 for(const length of [undefined,0,-18000])assert.equal(paceFraction(now,length,now),null);
 assert.equal(paceFraction(undefined,span,now),null);
 for(const [delta,tier]of [[-26,0],[-25,1],[-11,1],[-10,2],[4,2],[5,3],[14,3],[15,4],[29,4],[30,5]])assert.equal(paceTier(50+delta,.5,95),tier);
 assert.equal(roundedPaceDelta(24.5,.5),-26);assert.equal(roundedPaceDelta(54.5,.5),5);
 assert.equal(paceTier(100,.099,95),null);assert.equal(paceTier(95,.9,95),5);
 for(const [used,tier] of [[79,2],[80,4],[95,5]])assert.equal(gaugeTier(used,null,80,95),tier);
 const window={usedPercent:40,resetsAt:now+4500000,spanSeconds:span};
 assert.equal(quotaPresentation(window,undefined,false,now).marker,.75);
 assert.equal(quotaPresentation(window,undefined,true,now).marker,.25);
 assert.equal(quotaPresentation(window,undefined,true,now).percent,60);
});

test('hpLevel maps gauge tiers to ok/warn/bad and follows gaugeTier thresholds',()=>{
 for(const [gauge,level] of [[0,'ok'],[2,'ok'],[3,'warn'],[4,'warn'],[5,'bad']])assert.equal(hpLevel(gauge),level);
 for(const [used,level] of [[79,'ok'],[80,'warn'],[94,'warn'],[95,'bad']])assert.equal(hpLevel(gaugeTier(used,null,80,95)),level);
});

test('depletion uses official percent and only stable burns; reset equality is safe',()=>{
 const block={totalTokens:3000000,tokensPerMinute:10000,startTime:now-300*60000,endTime:now};
 for(const [tokens,burn,used]of [[0,10000,50],[10000,9999,50],[10000,10000,4.99],[10000,10000,100],[1000000000,10000,5]])assert.equal(forecastDepletion(tokens,burn,used,now),null);
 assert.equal(forecastDepletion(3000000,10000,50,now),now+300*60000);
 assert.deepEqual(forecast(block,50,now+301*60000,now),{at:now+300*60000,beforeReset:true});
 assert.deepEqual(forecast(block,50,now+300*60000,now),{at:now+300*60000,beforeReset:false});
 assert.deepEqual(forecast(undefined,100,now+1000,now),{at:now,beforeReset:true});
 assert.equal(forecast(block,50,undefined,now),null);assert.equal(forecast(undefined,50,now,now),null);
 assert.equal(quotaPresentation({usedPercent:50,resetsAt:now+3600000},block,false,now).forecast,null);
});

test('account ownership follows prompt switches, forks, ties and clock skew',()=>{
 const accounts=[{id:'a',prompts:{s:[now-120000],fork:[now+60000]}},{id:'b',prompts:{s:[now-60000]}}];
 assert.equal(accountOwner(['s','fork'],now-90000,accounts),'a');
 assert.equal(accountOwner(['s'],now,accounts),'b');
 assert.equal(accountOwner(['s'],now-180000,accounts),'a');
 assert.equal(accountOwner(['unknown'],now,accounts),undefined);
 assert.equal(accountOwner(['s'],now,[accounts[0],{id:'tie',prompts:accounts[0].prompts}]),'a');
});

test('real prompt histories pair each account with its own official window and forecast',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ptb-quota-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sources=[{id:'a',roots:[root],isDefault:true},{id:'b',roots:[root],isDefault:false}];
 // Each source has its own directory, as the production discovery supplies.
 const {mkdir}=await import('node:fs/promises');sources[1].roots=[join(root,'b')];await mkdir(sources[1].roots[0]);
 await writeFile(join(root,'history.jsonl'),JSON.stringify({sessionId:'shared',timestamp:now-18000000})+'\n');
 await writeFile(join(root,'b/history.jsonl'),JSON.stringify({sessionId:'shared',timestamp:now-120000})+'\n');
 const entry=(minutes,total,session='shared')=>({time:now-minutes*60000,tokens:{total},claudeSessions:[session]});
 const entries=[entry(240,9000000),entry(60,600000),entry(1,20000),entry(0,999999,'unattributed'),entry(120,0)];
 const results=[{provider:'claude',accountID:'a',status:'available',windows:[{label:'5시간',usedPercent:50,resetsAt:now+4*3600000,forecastEligible:true}]},{provider:'claude',accountID:'b',status:'available',windows:[{label:'5시간',usedPercent:20,resetsAt:now+2*3600000,forecastEligible:true}]}];
 const out=await withAccountBlocks(results,entries,sources,now);
 assert.equal(out[0].block.totalTokens,600000);assert.equal(out[0].block.endTime,results[0].windows[0].resetsAt);
 assert.equal(out[1].block.totalTokens,20000);assert.equal(out[1].block.tokensPerMinute,20000);
 assert.equal(forecast(out[0].block,50,out[0].windows[0].resetsAt,now).at,now+3600000);
 assert.equal(forecast(out[1].block,20,out[1].windows[0].resetsAt,now).at,now+4*60000);
 for(const window of [{resetsAt:now},{notStarted:true}]){
  const changed=structuredClone(results);Object.assign(changed[0].windows[0],window);if(window.notStarted)delete changed[0].windows[0].resetsAt;
  const fresh=await withAccountBlocks(changed,entries,sources,now);assert.equal(fresh[0].block,undefined);assert.ok(fresh[1].block);
 }
 // Mac deliberately uses the machine-wide Claude block when only one account exists.
 const single=await withAccountBlocks([results[0]],entries,sources.slice(0,1),now);
 assert.deepEqual(single[0].block,activeBlock(entries,now));
 assert.deepEqual(accountBlocks(entries,[{id:'a',prompts:{shared:[now-18000000]}}],{a:{notStarted:true}},now),{});
});

test('all official window kinds map to Mac pace spans; unknown billing spans stay hidden',()=>{
 for(const [kind,seconds]of [['session',18000],['weekly_all',604800],['weekly_scoped',604800],['monthly',undefined]]){
  assert.equal(parseLimits('claude',{limits:[{kind,percent:42}]},now)[0].spanSeconds,seconds);
 }
 for(const minutes of [300,10080,90,0,-60]){
  const window=parseLimits('codex',{rateLimits:{primary:{usedPercent:42,windowDurationMins:minutes}}},now)[0];
  assert.equal(paceFraction(now,window.spanSeconds,now),minutes>0?1:null);
 }
 assert.equal(parseLimits('cursor',{planUsage:{totalPercentUsed:50}},now)[0].spanSeconds,undefined);
});

test('same samples agree with arithmetic expressions read from Mac '+macReferenceRef,{skip:!hasMacReference},async()=>{
 const source=readMacSource('Sources/PokeTokenBar/Core/UsageStore.swift');
 // Evaluate the original arithmetic, translating only Swift date/unit and numeric casts.
 const expression=name=>source.match(new RegExp('let '+name+' = ([^\\r\\n]+)'))[1];
 const paceExpression=expression('fraction').replace('resetsAt.timeIntervalSince(now)','((reset-now)/1000)');
 const macPace=new Function('span','reset','now','return '+paceExpression);
 const tokenExpression=expression('tokensPerPercent').replace('Double(blockTokens)','blockTokens');
 const macMinutes=new Function('blockTokens','utilization', 'tokensPerMinute','const tokensPerPercent='+tokenExpression+';return '+expression('minutesLeft'));
 for(const seconds of [0,1,4500,9000,18000])assert.equal(paceFraction(now+seconds*1000,span,now),macPace(span,now+seconds*1000,now));
 for(const used of [5,6,10,15,20,25,30,40,50,60,70,80,90,95,99.9])for(const tokens of [10000,600000,3000000])for(const burn of [10000,20000,100000]){
  const minutes=macMinutes(tokens,used,burn);assert.equal(forecastDepletion(tokens,burn,used,now),minutes<1440?now+minutes*60000:null);
 }
 assert.match(source,/utilization >= 5, utilization < 100, blockTokens > 0/);
 assert.match(source,/tokensPerMinute >= 10_000/);assert.match(source,/minutesLeft < 60 \* 24/);
 const tier=readMacSource('Sources/PokeTokenBar/Core/PaceTier.swift');
 assert.deepEqual([...tier.matchAll(/case \.\.<\((-?\d+)\)|case \.\.<(\d+)/g)].map(m=>Number(m[1]??m[2])),[-25,-10,5,15,30]);
 assert.match(tier,/minimumPace = 0\.1/);
});

test('all 649 Mac-supported species are registered in dex, hatch data and battle catalog',async()=>{
 const maximum=649;
 if(hasMacReference){const mac=readMacSource('Sources/PokeTokenBar/Core/CompanionModel.swift');assert.equal(Number(mac.match(/animatedSpeciesIDs = 1\.\.\.(\d+)/)[1]),maximum);}
 const ids=Array.from({length:maximum},(_,i)=>i+1);
 assert.deepEqual([...nationalDex.keys()],ids);assert.deepEqual(hatchData.map(row=>row[0]),ids);
 const catalog=JSON.parse(await readFile('src/companion-data/catalog.json','utf8'));
 for(const id of ids){const species=speciesFor(id);assert.ok(species.name&&!species.name.startsWith('포켓몬 #'),String(id));assert.ok(species.type,String(id));assert.ok(catalog.species[String(id)],'battle species '+id);}
});

test('historical ability options are identical to feature/battle and form names cover every referenced localized variant',{skip:!hasMacReference},async()=>{
 const expected=JSON.parse(readMacSource('Sources/PokeTokenBar/Resources/BattleText/ability-options.json'));
 assert.deepEqual(JSON.parse(await readFile('src/companion-data/ability-options.json','utf8')),expected);
 const forms=JSON.parse(await readFile('src/companion-data/form-names.json','utf8'));
 for(const variants of Object.values(forms))for(const translations of Object.values(variants))for(const language of ['ko','en','ja','es','fr','pt','de','ru'])assert.ok(translations[language]);
 assert.equal(Object.values(forms).reduce((sum,row)=>sum+Object.keys(row).length,0),56);
});
