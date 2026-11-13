import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';
import{cleanHistory,mergeHistory,makeRecap,currentStreak,dayKey,recapPeriod}from'../dist/shared/usage-recap.js';
import{UsageHistoryStore}from'../dist/main/usage/history.js';
import{collectUsage}from'../dist/main/usage/scan.js';
import{providerFixtures}from'./provider-fixtures.mjs';
import{referenceTime}from'./usage-fixtures.mjs';
test('derived history survives restart, month rollover and log rotation without reducing recorded totals',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ptb-history-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'history.json'),store=new UsageHistoryStore(path);
 await store.merge({'2026-10-31':500},new Date(2026,9,31));await store.merge({'2026-11-01':200},new Date(2026,10,1));await store.merge({'2026-11-01':10},new Date(2026,10,1));
 const restored=await new UsageHistoryStore(path).read();assert.equal(restored.tokensByDay['2026-11-01'],200);assert.equal(restored.tokensByDay['2026-10-31'],500);assert.equal(restored.coveredSince,'2026-10-01');assert.equal(currentStreak(restored,new Date(2026,10,2)).days,2);
 await Promise.all([store.merge({'2026-11-01':300},new Date(2026,10,1)),store.merge({'2026-11-01':250},new Date(2026,10,1))]);assert.equal((await store.read()).tokensByDay['2026-11-01'],300);
});
test('unknown history stays distinct from zero and future; comparisons use elapsed calendar days',()=>{
 const fresh=mergeHistory(cleanHistory(null),{'2026-11-03':100},new Date(2026,10,3)),month=makeRecap(fresh,'month',new Date(2026,10,3));assert.equal(month.previousTotal,null);assert.equal(month.countedDays,3);assert.equal(month.buckets[3].hasData,false);assert.equal(month.buckets[1].hasData,true);assert.equal(month.buckets[1].tokens,0);assert.equal(month.canGoBack,false);
 const history={version:1,coveredSince:'2025-01-01',tokensByDay:{'2026-10-01':20,'2026-10-02':30,'2026-10-03':50,'2026-10-20':1000,'2026-11-03':200}},recap=makeRecap(history,'month',new Date(2026,10,3));assert.equal(recap.previousTotal,100);assert.equal(recap.delta,1);assert.equal(recap.total,200);assert.equal(recap.activeDays,1);assert.equal(recap.bestDay.key,'2026-11-03');assert.equal(recap.canGoBack,true);
 assert.equal(makeRecap(history,'year',new Date(2026,10,3)).buckets.length,12);assert.equal(makeRecap(history,'month',new Date(2024,1,29)).buckets.length,29);
 const pruned=mergeHistory({...history,tokensByDay:{'2024-12-31':1,...history.tokensByDay}}, {},new Date(2026,10,3));assert.equal(pruned.tokensByDay['2024-12-31'],undefined);assert.equal(pruned.coveredSince,'2025-01-01');
 assert.deepEqual(cleanHistory({tokensByDay:{'2026-02-30':1,junk:9,'2026-02-20':-1},coveredSince:'bad'}),{version:1,tokensByDay:{}});
});
test('DST days use local calendar steps, including the Sunday week boundary',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import{makeRecap,dayKey,recapPeriod}from${JSON.stringify(new URL('../dist/shared/usage-recap.js',import.meta.url).href)};const history={version:1,coveredSince:'2026-01-01',tokensByDay:{'2026-03-07':1,'2026-03-08':2,'2026-03-09':3}};console.log(JSON.stringify({month:makeRecap(history,'month',new Date(2026,2,10)),week:dayKey(recapPeriod('week',new Date(2026,2,9),0,0).start)}));`],{env:{...process.env,TZ:'America/New_York'},encoding:'utf8'}));assert.equal(result.month.buckets.length,31);assert.equal(result.month.total,6);assert.equal(result.month.bestStreak,3);assert.equal(result.week,'2026-03-08');
});
test('today model breakdowns come from the same deduplicated entries as provider totals',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ptb-models-'));t.after(()=>rm(dir,{recursive:true,force:true}));const roots=await providerFixtures(dir);for(const provider of ['claude','codex']){const usage=await collectUsage(provider,roots[provider],new Date(referenceTime),[]);assert.ok(Object.keys(usage.todayModels).length);assert.equal(Object.values(usage.todayModels).reduce((a,b)=>a+b,0),usage.today.total);}
});
test('recap results match the original Mac ledger and period calculations on identical samples',()=>{
 const cases=[];for(const scope of ['week','month','year'])for(const now of ['2026-11-03T12:00:00Z','2024-03-10T12:00:00Z'])for(const offset of [0,-1])cases.push({scope,now,offset,firstWeekday:1,coveredSince:'2023-01-01',tokensByDay:{'2024-02-29':50,'2024-03-01':25,'2026-10-01':20,'2026-10-02':30,'2026-11-01':100,'2026-11-02':50,'2026-11-03':200}});
 if(process.env.POKE_MAC_RECAP_ORACLE){const expected=JSON.parse(execFileSync(process.env.POKE_MAC_RECAP_ORACLE,{input:JSON.stringify(cases),encoding:'utf8',env:{...process.env,LLVM_PROFILE_FILE:'/private/tmp/ptb-recap-oracle.profraw'}}));for(let i=0;i<cases.length;i++){const row=cases[i],actual=makeRecap({version:1,coveredSince:row.coveredSince,tokensByDay:row.tokensByDay},row.scope,new Date(row.now),row.offset,row.firstWeekday);assert.deepEqual(actual,expected[i],JSON.stringify(row));}}
 else assert.equal(makeRecap({version:1,tokensByDay:{}},'week',new Date(2026,10,3)).buckets.length,7);
});
