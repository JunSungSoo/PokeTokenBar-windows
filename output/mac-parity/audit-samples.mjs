// Read-only product audit; all save mutations below use a disposable test directory.
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {CompanionStore} from '../../dist/main/companion/store.js';
import {limitWarning} from '../../dist/shared/limit-tracking.js';
import {projectDetailView} from '../../dist/shared/pokemon-details.js';
import {activityState} from '../../dist/shared/companion-presentation.js';
import {forecast} from '../../dist/shared/quota-presentation.js';
import {appearance} from '../../dist/main/companion/forms.js';
import {parsePokemonDetails,presentPokemonDetails} from '../../dist/main/companion/pokemon-details.js';
import {detailFixture,method} from '../../tests/pokemon-details-fixtures.mjs';

const now=1800000000000,dir=await mkdtemp(join(tmpdir(),'ptb-parity-audit-')),output={};
try{
 const store=new CompanionStore(join(dir,'save.json'),()=>false);
 await store.replaceImport({raised:0,progress:4999999,active:null,graduated:[],pendingHatchID:1,eggPrayers:3},now);
 await store.update(new Map([['claude',[{id:'audit-hatch',time:now+1,tokens:{input:1,output:0,cacheRead:0,cacheWrite:0,total:1}}]]]),now+1);
 const fixture=detailFixture(1),metadata=parsePokemonDetails(fixture.pokemon,fixture.species,1);
 await store.enrichMoves(metadata);
 const state=await store.read(),saved=JSON.parse(await readFile(join(dir,'save.json'),'utf8'));
 assert.equal(state.active.species[0].number,1);
 assert.ok(state.active.ability);assert.ok(state.active.gender);assert.equal(state.active.prayers,3);
 output.nativeHatchAfterMetadata={speciesID:1,ability:state.active.ability??null,gender:state.active.gender??null,knownMoves:state.active.moves,prayersBeforeHatch:3,prayersOnIndividual:saved.active.prayers??null,prayersOnEgg:saved.eggPrayers??null};

 output.warningSamples=[];
 for(const used of [85,50]){
  const prediction=forecast({totalTokens:600000,tokensPerMinute:10000,startTime:now-3600000,endTime:now+7200000},used,now+7200000,now);
  // Mac isLimitWarning for a sole tracked Claude account: crit threshold or depletion.
  const macWarning=used>=95||prediction?.beforeReset===true;
  const windowsWarning=limitWarning([{provider:'claude',accountID:'claude-default',status:'available',block:{totalTokens:600000,tokensPerMinute:10000,startTime:now-3600000,endTime:now+7200000},windows:[{usedPercent:used,resetsAt:now+7200000,forecastEligible:true}]}],95,'automatic',now);assert.equal(windowsWarning,macWarning);
  output.warningSamples.push({usedPercent:used,forecastBeforeReset:prediction?.beforeReset,macWarning,windowsWarning,macMood:activityState(true,1,0,now,macWarning,now),windowsMood:activityState(true,1,0,now,windowsWarning,now)});
 }
 // An 85% account with no stable burn should remain calm in Mac's global warning rule.
 output.warningWithoutForecast={usedPercent:85,macWarning:false,windowsWarning:limitWarning([{provider:'claude',status:'available',windows:[{usedPercent:85}]}],95,'automatic',now)};

 const arceus=detailFixture(493);arceus.pokemon.name='arceus';arceus.pokemon.types=[{slot:1,type:{name:'normal'}}];
 arceus.pokemon.moves=[{move:{name:'judgment'},version_group_details:[method('level-up',100)]}];
 const view=projectDetailView(presentPokemonDetails(parsePokemonDetails(arceus.pokemon,arceus.species,493),'en'),'fire');
 output.arceusFire={appearance:appearance(493,'fire').form,detailsTypes:view.details.types,judgmentType:view.labels.moves.judgment.type,macExpectedTypes:['fire'],macExpectedJudgmentType:'Fire'};
 assert.equal(output.arceusFire.appearance,'fire');assert.deepEqual(view.details.types,['fire']);assert.equal(output.arceusFire.judgmentType,'Fire');
 await writeFile(new URL('./audit-samples.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output,null,2));
}finally{await rm(dir,{recursive:true,force:true});}
