import { app, dialog,ipcMain, type BrowserWindow } from 'electron';
import {resolveLanguage,translate} from '../../shared/localization.js';
import type { BattleAction, BattleMode } from '../../shared/battle.js';
import type { CompanionStore } from '../companion/store.js';
import { object } from '../usage/jsonl.js';
import { ChallengeStore } from './challenge.js';
import { eligible, ownedMember, practiceTeam,withItems } from './team.js';
import {BattleAssets} from './assets.js';
import {BattleWindows} from './windows.js';
import type {SettingsStore} from '../settings.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeSaveAtomically} from '../companion/store.js';
import {LanBattle} from './lan.js';
import{assignHeldItems}from'../../shared/held-items.js';
import{heldItems}from'../companion/battle-items.js';
import{formCatalog}from'../companion/forms.js';
import type{OfferedItem}from'../trade/item.js';
import type {CompanionView} from '../../shared/companion.js';
import type {ShopItem} from './challenge-rules.js';

function modeOf(value: unknown): BattleMode {
  if (value === 'singles' || value === 'doubles') return value;
  throw new Error('싱글 또는 더블을 선택해 주세요.');
}

function actionsOf(value: unknown): BattleAction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new Error('배틀 행동을 선택해 주세요.');
  return value.map(raw => {
    const action = object(raw);
    if (action?.kind === 'pass') return { kind: 'pass' };
    if (typeof action?.index === 'number' && Number.isInteger(action.index)) {
      if (action.kind === 'switch') return { kind: 'switch', index: action.index };
      if (action.kind === 'move' && typeof action.target === 'number' && Number.isInteger(action.target)) {
        return { kind: 'move', index: action.index, target: action.target, ...(action.mega === true ? { mega: true } : {}) };
      }
    }
    throw new Error('잘못된 배틀 행동입니다.');
  });
}

function equippedTeam(offers:OfferedItem[],input:unknown){const team=offers.map(ownedMember),candidates=team.map((p,index)=>({...p,battleDefaultItem:offers[index].item.battleDefaultItem})),defaults=assignHeldItems(team.map(p=>p.id),candidates,{},{},heldItems,formCatalog);return withItems(team.map(p=>({...p,item:defaults[p.id]})),input);}

export function registerBattleIPC(companion: CompanionStore, mainWindow: () => BrowserWindow | undefined,preferences:SettingsStore,reveal?:(window:BrowserWindow)=>void,notify?:(value:CompanionView)=>void,options:{seed?:()=>number[];tradeActive?:()=>boolean;activityChanged?:()=>void;rewardTest?:boolean}={}) {
  const rewardTest = !app.isPackaged && options.rewardTest === true;
  const store = new ChallengeStore(app.getPath('userData'),options.seed,rewardTest);
  const windows=new BattleWindows(reveal),assets=new BattleAssets();
  windows.changed=options.activityChanged;
  const lan=new LanBattle(app.getPath('userData'),value=>{
    const main=mainWindow();if(main&&!main.isDestroyed())main.webContents.send('battle:lan-changed',value);windows.lan(value);
    options.activityChanged?.();
    if(value.phase==='preparing' && !windows.main)void windows.open('lan').catch(()=>{});
  });
  const confirmExit=async()=>{
    const cpu=windows.kind==='challenge'&&windows.main?await store.resume('singles',true):null;
    if(!lan.active()&&cpu?.phase!=='battling')return true;
    const t=(text:string)=>translate(text,resolveLanguage(preferences.get().language,app.getLocale()));
    const settings={type:'question' as const,message:t('대전을 기권하고 창을 닫으시겠습니까?'),buttons:[t('취소'),t('기권 후 닫기')],defaultId:0,cancelId:0};
    const response=windows.main?await dialog.showMessageBox(windows.main,settings):await dialog.showMessageBox(settings);
    if(response.response!==1)return false;
    if(lan.active())lan.surrender();else if(cpu){const value=await store.surrender('singles');windows.broadcast(value);}
    return true;
  };
  windows.canClose=confirmExit;
  const battleContext = () => ({...preferences.get(),...(rewardTest?{rewardTest}: {})});
  preferences.subscribe(()=>windows.context(battleContext()));
  let quitting=false,checkingQuit=false;
  app.on('before-quit',event=>{if(quitting||!windows.main&&!lan.active()){lan.shutdown();assets.close();return;}event.preventDefault();if(checkingQuit)return;checkingQuit=true;void confirmExit().then(async ok=>{if(ok){await store.finishWrites();await lan.finishWrites();quitting=true;windows.allowClose=true;lan.shutdown();assets.close();app.quit();}}).catch(error=>console.error('Battle exit failed:',error)).finally(()=>{checkingQuit=false;});});
  const audioPath=join(app.getPath('userData'),'battle-presentation-v1.json');
  let audioQueue:Promise<unknown>=Promise.resolve();
  let audio: {music:number;effects:number;enabled:boolean;typeHints?:boolean}|undefined;
  let entering=false;
  function handle(channel: string, callback: (...values: unknown[]) => unknown): void {
    ipcMain.handle('battle:' + channel, (event, ...values) => {
      const window = mainWindow();
      if ((!window || event.senderFrame !== window.webContents.mainFrame) && !windows.owns(event.senderFrame)) throw new Error('Unexpected battle request');
      if (!['choices','resume','assets','context','audio','auxiliary'].includes(channel) && !(channel==='lan'&&['state','history'].includes(values[0] as string)) &&
          event.senderFrame!==window?.webContents.mainFrame && !windows.isMain(event.senderFrame))throw new Error('Unexpected battle command');
      const starts=channel==='open'||channel==='start'||channel==='lan'&&['host','connect','register','ready'].includes(String(values[0]));
      if(starts&&options.tradeActive?.())throw new Error('진행 중인 교환을 먼저 종료해 주세요.');
      if(starts){if(entering)throw new Error('배틀을 준비하는 중입니다.');entering=true;options.activityChanged?.();return Promise.resolve().then(()=>callback(...values)).finally(()=>{entering=false;options.activityChanged?.();});}
      return callback(...values);
    });
  }
  handle('open',kind=>{if(kind!==undefined&&kind!=='challenge'&&kind!=='lan')throw new Error('Invalid battle window');if(kind!=='lan'&&lan.active())throw new Error('진행 중인 대전을 먼저 종료해 주세요.');return windows.open(kind==='lan'?'lan':'challenge');});handle('close-window',()=>windows.close());
  handle('lan',async(command,value)=>{
    switch(command){
      case'state':return lan.state();case'history':return lan.history();
      case'host':{if(windows.main&&windows.kind==='challenge')throw new Error('챌린지 창을 먼저 닫아 주세요.');const {tradeNickname,profileIcon}=preferences.get();return lan.host(tradeNickname,profileIcon);}
      case'connect':{if(windows.main&&windows.kind==='challenge')throw new Error('챌린지 창을 먼저 닫아 주세요.');if(typeof value!=='string')throw new Error('Invalid connection code');const {tradeNickname,profileIcon}=preferences.get();return lan.connect(value,tradeNickname,profileIcon);}
      case'register':{const row=object(value),ids=Array.isArray(value)?value:row?.ids;if(!Array.isArray(ids)||ids.length!==6||!ids.every(id=>typeof id==='string')||new Set(ids).size!==6)throw new Error('개체 6마리를 선택해 주세요.');const offers=await Promise.all(ids.map(id=>companion.tradeOffer(id)));return lan.register(equippedTeam(offers,row?.items));}
      case'ready':if(!Array.isArray(value)||!value.every(id=>typeof id==='string'))throw new Error('Invalid lineup');return lan.ready(value);
      case'unready':return lan.unready();case'surrender':return lan.surrender();case'cancel':return lan.cancel();
      case'choose':{const row=object(value);if(typeof row?.decisionID!=='string'||row.decisionID.length>128)throw new Error('Invalid decision');return lan.choose(row.decisionID,actionsOf(row.actions));}
      default:throw new Error('Invalid battle command');
    }
  });
  handle('context',battleContext);handle('assets',()=>assets.start());
  handle('auxiliary',async (kind,visible)=>{if(kind!=='field' && kind!=='stats')throw new Error('Invalid battle panel');if(visible!==undefined&&typeof visible!=='boolean')throw new Error('Invalid panel visibility');await windows.auxiliary(kind,visible);if(visible===false)return;if(windows.kind==='lan')windows.lan(await lan.state());else{const state=await store.resume('singles',true);if(state)windows.broadcast(state);}});
  handle('audio',patch=>{const operation=audioQueue.then(async()=>{
    if(!audio){try{const saved=JSON.parse(await readFile(audioPath,'utf8'));if(![saved.music,saved.effects].every(n=>typeof n==='number'&&n>=0&&n<=1)||typeof saved.enabled!=='boolean'||saved.typeHints!==undefined&&typeof saved.typeHints!=='boolean')throw Error();audio=saved;}catch{audio={music:.35,effects:.35,enabled:true};}}
    if(patch!==undefined){const row=object(patch);if(!row || Object.keys(row).some(key=>!['music','effects','enabled','typeHints'].includes(key)) ||
      ['music','effects'].some(key=>row[key]!==undefined && (typeof row[key]!=='number'||!Number.isFinite(row[key])||Number(row[key])<0||Number(row[key])>1)) ||
      (row.enabled!==undefined && typeof row.enabled!=='boolean') || (row.typeHints!==undefined && typeof row.typeHints!=='boolean'))throw new Error('Invalid battle audio');
      audio={...audio,...row} as typeof audio;await writeSaveAtomically(audioPath,JSON.stringify(audio));}
    return audio;
  });audioQueue=operation.catch(()=>{});return operation;});

  handle('choices', async purpose => {if(purpose!==undefined&&purpose!=='champion')throw new Error('Invalid battle roster');return (await companion.read()).captures.flatMap(capture => {
    const species = capture.species.at(-1);
    return species && capture.releasedAt === undefined && (purpose==='champion'?!capture.shiny:eligible(species.number))
      ? [{ id: capture.id, speciesID: species.number,
        battleDefaultItem:capture.battleDefaultItem,championAchievedAt:capture.championAchievedAt,shiny:capture.shiny,form:capture.form,level:capture.level ?? 100,
        label: `${capture.shiny ? '★ ' : ''}${species.name}${capture.form ? ' · ' + capture.form : ''} · Lv.${capture.level ?? 100}` }] : [];
  });});
  async function synchronize(value:import('../../shared/battle.js').ChallengeView|null){if(value?.phase==='cleared'&&value.progress){const state=await companion.markChallengeChampions(value.progress.team.map(p=>p.id));if(state)notify?.(state);}return value;}
  handle('resume', mode => store.resume(modeOf(mode),true).then(synchronize));
  handle('start', async (mode, ids,items) => {
    if(lan.active())throw new Error('진행 중인 대전을 먼저 종료해 주세요.');const selected = modeOf(mode);
    if (ids === null) return store.start(selected, practiceTeam(), true,true);
    if (!Array.isArray(ids) || ids.length !== 6 || new Set(ids).size !== 6 ||
      !ids.every(id => typeof id === 'string' && id.length <= 128)) throw new Error('도감에서 개체 6마리를 골라 주세요.');
    const team = equippedTeam(await Promise.all(ids.map(id => companion.tradeOffer(id))),items);
    if (new Set(team.map(member => member.speciesID)).size !== 6) throw new Error('서로 다른 종 6마리를 골라 주세요.');
    return store.start(selected,team,false,true);
  });
  handle('cpu',async(command,value)=>{
    if(lan.active())throw new Error('진행 중인 대전을 먼저 종료해 주세요.');
    const row=object(value)??{},id=typeof row.id==='string'?row.id:'',move=typeof row.moveIndex==='number'&&Number.isInteger(row.moveIndex)&&row.moveIndex>=0&&row.moveIndex<4?row.moveIndex:undefined;
    let result;
    switch(command){
      case'test-victory':
        if(!rewardTest || typeof row.checkpoint!=='string')throw new Error('테스트 승리를 사용할 수 없습니다.');
        result=await store.surrender('singles',row.checkpoint);break;
      case'prepare':if(!Array.isArray(row.order)||!row.order.every(id=>typeof id==='string')||typeof row.begin!=='boolean')throw new Error('Invalid lineup');result=await store.prepare('singles',row.order,row.items,row.begin);break;
      case'purchase':result=await store.purchase('singles',row.item as ShopItem,id,move);break;
      case'reward':{const incoming=row.kind==='replace'&&typeof row.incoming==='string'?ownedMember(await companion.tradeOffer(row.incoming)):undefined;result=await store.reward('singles',String(row.kind),id,move,incoming);break;}
      case'next':result=await store.next('singles');break;
      case'claim':result=await store.claim('singles',id||undefined,async award=>{const state=await companion.claimChallenge(award);notify?.(state);});break;
      default:throw new Error('Invalid challenge command');
    }
    windows.broadcast(result);return result;
  });
  handle('choose', (mode, id, actions) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('잘못된 턴입니다.');
    return store.choose(modeOf(mode), id, actionsOf(actions)).then(async value=>{await synchronize(value);windows.broadcast(value);return value;});
  });
  handle('advance', (mode, reward, checkpoint) => {
    if ((reward !== 'heal' && reward !== 'pp' && reward !== 'all' && reward !== 'skip') || typeof checkpoint !== 'string') {
      throw new Error('잘못된 회복 보상입니다.');
    }
    return store.advance(modeOf(mode), reward, checkpoint);
  });
  handle('surrender', mode => store.surrender(modeOf(mode)));
  return {store,lan,windows,assets,isBusy:()=>entering||!!windows.main&&windows.kind==='challenge'||['connecting','connected','preparing','playing','reconnecting'].includes(lan.state().phase),blocksUpdate:()=>lan.active(),finishWrites:async()=>{await store.finishWrites();await lan.finishWrites();await audioQueue;},prepareHandoff:async()=>{lan.shutdown();await store.finishWrites();await lan.finishWrites();await audioQueue;quitting=true;windows.allowClose=true;assets.close();}};
}
