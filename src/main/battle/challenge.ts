import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BattleAction, BattleMode, BattleReward, ChallengeView } from '../../shared/battle.js';
import { writeSaveAtomically } from '../companion/store.js';
import { OwnedBattle, allowedFairyMoves, battleDex, encounters, engineIdentity, freshResources, policyRevision,
  type Engine, type Member, type Resource } from './engine.js';
import{withItems}from'./team.js';
import{applyShop,needs,boosts,buffs,shopOrder,shopBase,victoryCash,type ShopItem,type BuffKind,type ChallengeProgress}from'./challenge-rules.js';

interface Decision { id: string; actions: BattleAction[] }
interface Run {
  version: 1;
  identity: string;
  id: string;
  mode: BattleMode;
  practice: boolean;
  team: Member[];
  encounter: number;
  seed: number[];
  resources: Resource[];
  decisions: Decision[];
  surrendered: boolean;
  progress?:ChallengeProgress;
}
interface Session { run: Run; engine: Engine }

function startEngine(run: Run): Engine {
  const ordered = run.mode === 'doubles'
    ? run.team.slice().sort((a, b) => Number(!run.resources.find(r => r.id === a.id)?.hp)
      - Number(!run.resources.find(r => r.id === b.id)?.hp)) : run.team;
  const participants = new Set(ordered.slice(0, run.mode === 'doubles' ? 4 : 6).map(p => p.id));
  const engine = new OwnedBattle(run.mode, [ordered, encounters[run.mode][run.encounter].team], run.seed, {
    profile: 'challenge', automaticOpponent: true, expectedPolicyRevision: policyRevision[run.mode],
    resources: [run.resources.filter(r => participants.has(r.id)), null],
    ...(run.progress?{challengeBoosts:boosts(run.progress.initialBuffs)}:{}),
    ...(run.mode === 'doubles' ? { challengeBattleSize: 4 } : {}),
  });
  engine.runCPU();
  for (const decision of run.decisions) {
    engine.choose(0, decision.id, decision.actions);
    engine.runCPU();
  }
  if (run.surrendered) engine.surrender(0);
  return engine;
}

function resourcesAfter(session: Session): Resource[] {
  const updates = new Map(session.engine.frame(0).resources.map(resource => [resource.id, resource]));
  return structuredClone(session.run.resources.map(resource => updates.get(resource.id) ?? resource));
}

function rewardTargets(run: Run, resources: Resource[]) {
  const missingHP = (r: Resource) => 1 - r.hp / run.team.find(p => p.id === r.id)!.stats.hp;
  const injured = resources.filter(r => missingHP(r) > 0).sort((a, b) => missingHP(b) - missingHP(a))[0];
  const depleted = resources.flatMap(resource => resource.moves.map(move => ({ resource, move })))
    .filter(({ move }) => move.pp < move.maxPP)
    .sort((a, b) => (b.move.maxPP - b.move.pp) - (a.move.maxPP - a.move.pp))[0];
  const enhanced = run.encounter >= (run.mode === 'singles' ? 15 : 7);
  return { injured, depleted, enhanced };
}

function view({ run, engine }: Session): ChallengeView {
  const source = engine.frame(0);
  const { resources: _privateResources,...publicFrame } = source;
  const { turn, decisionID, waiting, ended, winner, own, foe, slots, log } = source;
  const frame = { ...publicFrame,turn, decisionID: `${run.id}/${run.encounter}/${decisionID}`, waiting, ended, winner,
    own, foe, slots, log: log.map(line => line.startsWith('|t:|')?'|t:|0':line) };
  const encounterCount = encounters[run.mode].length;
  const phase = run.progress?.stage ?? (!ended ? 'battling' : winner !== 0 ? 'lost'
    : run.encounter + 1 === encounterCount ? 'cleared' : 'reward');
  const rewards: ChallengeView['rewards'] = [];
  if (phase === 'reward') {
    const { injured, depleted, enhanced } = rewardTargets(run, resourcesAfter({ run, engine }));
    const label = (id: string) => run.team.find(member => member.id === id)!.displayName;
    if ((run.encounter + 1) % 3 === 0) rewards.push({ kind: 'all', label: '팀 전체 HP·PP·상태 회복' });
    else {
      if (injured) rewards.push({ kind: 'heal', label: `${label(injured.id)} HP ${enhanced ? '전부' : '35%'} 회복` });
      if (depleted) rewards.push({ kind: 'pp', label: `${label(depleted.resource.id)} ${enhanced
        ? '모든 기술 PP 회복' : `${depleted.move.id} PP +3`}` });
      rewards.push({ kind: 'skip', label: '회복 없이 진행' });
    }
  }
  return { mode: run.mode, practice: run.practice, checkpoint: frame.decisionID, phase,
    encounter: run.encounter + 1, encounterCount, encounterID:encounters[run.mode][run.encounter].id,
    opponent: encounters[run.mode][run.encounter].nameKo, frame, rewards,
    preview:encounters[run.mode][run.encounter].team.map(p=>({id:p.id,speciesID:p.speciesID,level:p.level,shiny:p.shiny,form:p.form})),
    ...(run.progress?{progress:{...run.progress,shop:shopOrder.map(id=>({id,price:shopBase[id]+5*(run.progress!.purchases[id]??0)})),
      cash:phase==='lost'&&run.progress.victories.length>=3?run.progress.victories.slice(2).reduce((sum,n)=>sum+n,0)*1000000:0}}:{}) };
}

export class ChallengeStore {
  private queue: Promise<unknown> = Promise.resolve();
  private sessions = new Map<BattleMode, Session>();

  constructor(private directory: string, private seed = () => Array.from({ length: 4 }, () => randomInt(65536))) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(work);
    this.queue = operation.catch(() => {});
    return operation;
  }

  async finishWrites(): Promise<void> { await this.queue; }

  private path(mode: BattleMode) { return join(this.directory, `challenge-${mode}-v1.json`); }

  private async load(mode: BattleMode): Promise<Session | null> {
    const cached = this.sessions.get(mode);
    if (cached) return cached;
    const bytes = await readFile(this.path(mode), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (bytes === null) return null;
    try {
      if (bytes.length > 2_000_000) throw new Error('Oversize checkpoint');
      const run = JSON.parse(bytes) as Run;
      if (run.version !== 1 || run.identity !== engineIdentity || run.mode !== mode ||
        typeof run.id !== 'string' || typeof run.practice !== 'boolean' || typeof run.surrendered !== 'boolean' ||
        !Number.isInteger(run.encounter) || !encounters[mode][run.encounter] ||
        run.team.length !== 6 || run.resources.length !== 6 || run.seed.length !== 4 ||
        !run.seed.every(n => Number.isInteger(n) && n >= 0 && n < 65536) ||
        !Array.isArray(run.decisions) || run.decisions.length > 3000 ||
        new Set(run.resources.map(r => r.id)).size !== 6 ||
        !run.team.every(member => run.resources.some(r => r.id === member.id))) throw new Error('Invalid checkpoint');
      if(run.progress){const p=run.progress;if(!['preparation','battling','reward','intermission','lost','cleared'].includes(p.stage)||!Number.isSafeInteger(p.points)||p.points<0||p.points>10000||
        !Array.isArray(p.team)||p.team.length!==6||!Array.isArray(p.resources)||p.resources.length!==6||new Set(p.team.map(m=>m.id)).size!==6||new Set(p.resources.map(r=>r.id)).size!==6||
        !p.resources.every(r=>{const member=p.team.find(m=>m.id===r.id);return member&&Number.isInteger(r.hp)&&r.hp>=0&&r.hp<=member.stats.hp&&Array.isArray(r.moves)&&r.moves.length===member.moves.length&&r.moves.every(m=>Number.isInteger(m.pp)&&m.pp>=0&&Number.isSafeInteger(m.maxPP)&&m.maxPP>0&&m.maxPP<=64&&m.pp<=m.maxPP);})||
        !Array.isArray(p.buffs)||!Array.isArray(p.initialBuffs)||[...p.buffs,...p.initialBuffs].some(b=>!buffs.includes(b.kind)||!Number.isInteger(b.remaining)||b.remaining<1||b.remaining>3)||
        !p.purchases||Object.entries(p.purchases).some(([id,count])=>!shopOrder.includes(id as ShopItem)||!Number.isInteger(count)||count!<0||count!>1000)||
        !Array.isArray(p.retired)||!Array.isArray(p.victories)||p.victories.some(n=>![0,10,30,50].includes(n))||p.victories.length>encounters[mode].length)throw new Error('Invalid challenge progress');}
      const session = { run, engine: startEngine(run) };
      this.sessions.set(mode, session);
      return session;
    } catch (cause) {
      throw new Error('챌린지 저장을 복원할 수 없습니다. 저장 파일은 보존했습니다.', { cause });
    }
  }

  private async requireSession(mode: BattleMode): Promise<Session> {
    const session = await this.load(mode);
    if (!session) throw new Error('저장된 챌린지가 없습니다.');
    return session;
  }

  private async commit(session: Session): Promise<ChallengeView> {
    const progress=session.run.progress,frame=session.engine.frame(0);
    if(progress?.stage==='battling'&&frame.ended){
      progress.resources=resourcesAfter(session);progress.team=structuredClone(session.run.team);
      for(const p of progress.team)if(p.speciesID===235){const resource=progress.resources.find(r=>r.id===p.id)!;p.moves=p.moves.map((name,index)=>battleDex().moves.get(name).id==='sketch'?resource.moves[index].id:name);}
      progress.buffs=progress.buffs.filter(buff=>buff.remaining>1).map(buff=>({...buff,remaining:buff.remaining-1}));
      progress.stage=frame.winner!==0?'lost':session.run.encounter+1===encounters[session.run.mode].length?'cleared':'reward';
      if(frame.winner===0)progress.victories.push(victoryCash(session.run.encounter,session.run.mode));
      if(progress.stage==='reward')progress.roll=buffs[randomInt(buffs.length)];
      if(progress.stage==='cleared')progress.champion={claimed:false};
    }
    const snapshot = view(session);
    await writeSaveAtomically(this.path(session.run.mode), JSON.stringify(session.run));
    this.sessions.set(session.run.mode, session);
    return snapshot;
  }

  resume(mode: BattleMode,modern=false): Promise<ChallengeView | null> {
    return this.serialize(async () => {
      const session = await this.load(mode);
      if(session&&modern&&!session.run.progress){const phase=view(session).phase;session.run.progress={stage:phase as ChallengeProgress['stage'],points:Math.max(100,Array.from({length:session.run.encounter+(phase==='reward'||phase==='cleared'?1:0)},(_,i)=>100+20*Math.floor(i/3)).reduce((a,b)=>a+b,0)),purchases:{},team:structuredClone(session.run.team),resources:resourcesAfter(session),buffs:[],initialBuffs:[],retired:[],victories:Array.from({length:session.run.encounter+(phase==='reward'||phase==='cleared'?1:0)},(_,i)=>victoryCash(i,mode)),...(phase==='reward'?{roll:buffs[randomInt(buffs.length)]}:{}),...(phase==='cleared'?{champion:{claimed:false}}:{})};return this.commit(session);}
      return session && view(session);
    });
  }

  start(mode: BattleMode, team: Member[], practice: boolean,modern=false): Promise<ChallengeView> {
    return this.serialize(async () => {
      const current = await this.load(mode);
      if (current && (['preparation','battling', 'reward','intermission'].includes(view(current).phase)||current.run.progress?.champion?.claimed===false)) throw new Error('진행 중인 챌린지가 있습니다.');
      const run: Run = { version: 1, identity: engineIdentity, id: randomUUID(), mode, team, practice,
        encounter: 0, seed: this.seed(), resources: freshResources(team), decisions: [], surrendered: false };
      if(modern)run.progress={stage:'preparation',points:100,purchases:{},team:structuredClone(team),resources:freshResources(team),buffs:[],initialBuffs:[],retired:[],victories:[]};
      return this.commit({ run, engine: startEngine(run) });
    });
  }

  choose(mode: BattleMode, decisionID: string, actions: BattleAction[]): Promise<ChallengeView> {
    return this.serialize(async () => {
      const { run, engine } = await this.requireSession(mode);
      const current = view({ run, engine });
      if (current.phase !== 'battling' || current.frame.waiting || current.checkpoint !== decisionID) {
        throw new Error('이미 처리되었거나 지난 턴의 명령입니다.');
      }
      const id = current.checkpoint.slice(current.checkpoint.lastIndexOf('/') + 1);
      try {
        engine.choose(0, id, actions);
        engine.runCPU();
        return await this.commit({ engine, run: { ...run, decisions: [...run.decisions, { id, actions }] } });
      } catch (error) {
        this.sessions.delete(mode);
        throw error;
      }
    });
  }

  advance(mode: BattleMode, reward: BattleReward, checkpoint: string): Promise<ChallengeView> {
    return this.serialize(async () => {
      const session = await this.requireSession(mode);
      if(session.run.progress)throw new Error('보상을 적용한 뒤 다음 대전을 준비해 주세요.');
      const current = view(session);
      if (current.checkpoint !== checkpoint || !current.rewards.some(option => option.kind === reward)) {
        throw new Error('현재 챌린지에서 선택할 수 없는 회복 보상입니다.');
      }
      const { run } = session;
      const resources = resourcesAfter(session);
      const { injured, depleted, enhanced } = rewardTargets(run, resources);
      if (reward === 'heal' && injured) {
        const maxHP = run.team.find(member => member.id === injured.id)!.stats.hp;
        injured.hp = Math.min(maxHP, injured.hp + (enhanced ? maxHP : Math.max(1, Math.floor(maxHP * .35))));
      }
      if (reward === 'pp' && depleted) {
        if (enhanced) for (const move of depleted.resource.moves) move.pp = move.maxPP;
        else depleted.move.pp = Math.min(depleted.move.maxPP, depleted.move.pp + 3);
      }
      for (const resource of resources) {
        if (reward === 'all') {
          resource.hp = run.team.find(member => member.id === resource.id)!.stats.hp;
          for (const move of resource.moves) move.pp = move.maxPP;
        }
        if (reward === 'all' || resource.status === 'slp') {
          resource.status = '';
          delete resource.sleepStart;
          delete resource.sleepRemaining;
        }
      }
      const rules = battleDex();
      const team = run.team.map(member => {
        if (member.speciesID !== 235) return member;
        const carried = resources.find(resource => resource.id === member.id)!;
        const moves = member.moves.map((name, index) => {
          if (rules.moves.get(name).id !== 'sketch') return name;
          const learned = rules.moves.get(carried.moves[index].id);
          if (learned.exists && (learned.gen <= 5 || allowedFairyMoves.has(learned.id))) return learned.id;
          carried.moves[index] = freshResources([member])[0].moves[index];
          return name;
        });
        return { ...member, moves };
      });
      const next = { ...run, team, resources, encounter: run.encounter + 1, seed: this.seed(), decisions: [] };
      return this.commit({ run: next, engine: startEngine(next) });
    });
  }

  surrender(mode: BattleMode): Promise<ChallengeView> {
    return this.serialize(async () => {
      const { run, engine } = await this.requireSession(mode);
      if (view({ run, engine }).phase !== 'battling') throw new Error('진행 중인 배틀이 없습니다.');
      try {
        engine.surrender(0);
        return await this.commit({ engine, run: { ...run, surrendered: true } });
      } catch (error) {
        this.sessions.delete(mode);
        throw error;
      }
    });
  }

  prepare(mode:BattleMode,order:string[],items:unknown,begin:boolean):Promise<ChallengeView>{return this.serialize(async()=>{
    const session=await this.requireSession(mode),run=structuredClone(session.run),p=run.progress;
    if(!p||p.stage!=='preparation'||order.length!==6||new Set(order).size!==6||order.some(id=>!p.team.some(m=>m.id===id)))throw new Error('출전 순서를 확인해 주세요.');
    p.team=withItems(order.map(id=>({...p.team.find(m=>m.id===id)!,item:''})),items);p.resources=order.map(id=>({...p.resources.find(r=>r.id===id)!,item:p.team.find(m=>m.id===id)?.item??''}));
    run.team=structuredClone(p.team);run.resources=structuredClone(p.resources);run.decisions=[];run.surrendered=false;p.initialBuffs=structuredClone(p.buffs);
    if(begin){if(!p.resources.some(r=>r.hp>0))throw new Error('출전 가능한 포켓몬이 없습니다.');for(const r of p.resources)if(r.status==='slp'){r.status='';delete r.sleepStart;delete r.sleepRemaining;}run.resources=structuredClone(p.resources);p.stage='battling';}
    return this.commit({run,engine:startEngine(run)});
  });}

  purchase(mode:BattleMode,item:ShopItem,id:string,moveIndex?:number):Promise<ChallengeView>{return this.serialize(async()=>{
    const session=await this.requireSession(mode),run=structuredClone(session.run),p=run.progress;
    if(!p||!['reward','intermission'].includes(p.stage)||!shopOrder.includes(item)||(item==='ppMoveRecovery'&&moveIndex===undefined))throw new Error('현재 구매할 수 없는 도구입니다.');
    const price=shopBase[item]+5*(p.purchases[item]??0);const targets=p.resources.filter(r=>(item==='fullRecovery'||item==='teamHeal30'||r.id===id)&&needs(item,r,p.team.find(m=>m.id===r.id)!.stats.hp,moveIndex));
    if(p.points<price||!targets.length)throw new Error('포인트와 회복 대상을 확인해 주세요.');p.points-=price;p.purchases[item]=(p.purchases[item]??0)+1;for(const r of targets)applyShop(item,r,p.team.find(m=>m.id===r.id)!.stats.hp,moveIndex);
    return this.commit({run,engine:session.engine});
  });}

  reward(mode:BattleMode,kind:string,id:string,moveIndex:number|undefined,incoming?:Member):Promise<ChallengeView>{return this.serialize(async()=>{
    const session=await this.requireSession(mode),run=structuredClone(session.run),p=run.progress;if(!p||p.stage!=='reward')throw new Error('이미 적용했거나 선택할 수 없는 보상입니다.');
    const milestone=(run.encounter+1)%3===0,enhanced=run.encounter>=(mode==='singles'?15:7),r=p.resources.find(r=>r.id===id),member=p.team.find(m=>m.id===id);
    if(kind==='points')p.points+=50;
    else if(kind==='buff'&&p.roll)p.buffs.push({id:randomUUID(),kind:p.roll,remaining:3});
    else if(kind==='allHeal'&&milestone&&p.resources.some(r=>needs('fullRecovery',r,p.team.find(m=>m.id===r.id)!.stats.hp))){for(const resource of p.resources)applyShop('fullRecovery',resource,p.team.find(m=>m.id===resource.id)!.stats.hp);}
    else if(kind==='heal'&&!milestone&&r&&member&&r.hp<member.stats.hp){const fainted=r.hp===0;r.hp=Math.min(member.stats.hp,r.hp+(enhanced?member.stats.hp:Math.max(1,Math.floor(member.stats.hp*.35))));if(fainted){r.status='';delete r.sleepStart;delete r.sleepRemaining;}}
    else if(kind==='pp'&&!milestone&&r&&r.moves.some(m=>m.pp<m.maxPP)){if(enhanced)for(const move of r.moves)move.pp=move.maxPP;else if(moveIndex!==undefined&&r.moves[moveIndex]&&r.moves[moveIndex].pp<r.moves[moveIndex].maxPP)r.moves[moveIndex].pp=Math.min(r.moves[moveIndex].maxPP,r.moves[moveIndex].pp+3);else throw new Error('PP 회복 기술을 선택해 주세요.');}
    else if(kind==='replace'&&incoming&&r&&member&&!p.retired.includes(incoming.id)&&!p.team.some(m=>m.id===incoming.id||m.speciesID===incoming.speciesID)){
      let replacement:Member;try{replacement=withItems([incoming],{[incoming.id]:r.item})[0];}catch{replacement={...incoming,item:''};}const index=p.team.findIndex(m=>m.id===id);p.team[index]=replacement;p.resources[p.resources.findIndex(m=>m.id===id)]=freshResources([replacement])[0];p.retired.push(id);
    }else throw new Error('회복 보상과 대상을 확인해 주세요.');
    p.stage='intermission';return this.commit({run,engine:session.engine});
  });}

  next(mode:BattleMode):Promise<ChallengeView>{return this.serialize(async()=>{
    const session=await this.requireSession(mode),run=structuredClone(session.run),p=run.progress;
    if(!p||p.stage!=='intermission'||run.encounter+1>=encounters[mode].length)throw new Error('다음 대전을 준비할 수 없습니다.');run.encounter++;run.team=structuredClone(p.team);run.resources=structuredClone(p.resources);run.decisions=[];run.surrendered=false;run.seed=this.seed();p.stage='preparation';p.initialBuffs=structuredClone(p.buffs);delete p.roll;return this.commit({run,engine:startEngine(run)});
  });}

  claim(mode:BattleMode,id:string|undefined,apply:(award:{runID:string;cash:number;recipient?:string})=>Promise<void>):Promise<ChallengeView>{return this.serialize(async()=>{
    const session=await this.requireSession(mode),p=session.run.progress;if(!p)throw new Error('보상 기록이 없습니다.');const value=view(session);
    if(p.stage==='lost'){await apply({runID:session.run.id,cash:value.progress!.cash});return value;}
    if(p.stage!=='cleared'||!p.champion)throw new Error('챌린지를 완료한 뒤 선택해 주세요.');if(p.champion.claimed)return value;if(!id)throw new Error('이로치로 바꿀 포켓몬을 선택해 주세요.');
    if(p.champion.recipientID&&p.champion.recipientID!==id)throw new Error('이미 선택한 보상 대상을 확인해 주세요.');p.champion.recipientID=id;await this.commit(session);await apply({runID:session.run.id,cash:0,recipient:id});p.champion.claimed=true;return this.commit(session);
  });}
}
