import type {MoveText} from './pokemon-details.js';

/** BattleTextCatalog.moveTooltip includes allies for normal/any targeting. */
export function moveTarget(scope: string | undefined): string {
  const labels:Record<string,string>={all:'모두',allAdjacent:'모두 (자신 제외)',allAdjacentFoes:'상대 모두',
    self:'자신',adjacentAlly:'아군 단일',adjacentAllyOrSelf:'자신 또는 아군 단일',allyTeam:'아군 모두 (대기 포함)',
    allySide:'아군 모두 (진영)',foeSide:'상대 진영',randomNormal:'상대 단일 (무작위)',scripted:'반격 대상 (자동)',
    normal:'상대 또는 아군 단일',any:'상대 또는 아군 단일',adjacentFoe:'상대 단일'};
  return labels[scope ?? ''] ?? '—';
}

export function moveTooltip(move:MoveText,translate:(text:string)=>string): string {
  const category=translate(({Physical:'물리',Special:'특수',Status:'변화'} as Record<string,string>)[move.category] ?? move.category);
  const accuracy=move.accuracy===true?translate('필중'):typeof move.accuracy==='number'?String(move.accuracy)+'%':'—';
  const lines=[move.name,move.description || translate('기술 설명을 불러올 수 없습니다.')];
  if(move.type && move.category)lines.push(move.type+' · '+category+' · '+translate('위력')+': '+(move.power>0?move.power:'—')+' · '+translate('PP')+': '+move.pp);
  lines.push(translate('기본 명중률')+': '+accuracy,translate('대상')+': '+translate(moveTarget(move.targetScope)));
  return lines.join('\n');
}
