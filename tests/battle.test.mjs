import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChallengeStore } from '../dist/main/battle/challenge.js';
import { OwnedBattle, encounters, freshResources, policyRevision } from '../dist/main/battle/engine.js';
import { ownedMember, practiceTeam } from '../dist/main/battle/team.js';

const seed = () => [1, 2, 3, 4];

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ptb-battle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: new ChallengeStore(dir, seed) };
}

function play(view) {
  const bench = view.frame.own.flatMap((p, index) => p.active || p.fainted ? [] : [index + 1]);
  return view.frame.slots.map(slot => {
    if (slot.canPass) return { kind: 'pass' };
    if (slot.mustSwitch) return { kind: 'switch', index: bench.shift() };
    const score = move => move.power * (view.mode === 'doubles' && move.targetScope === 'allAdjacent' ? .65 : 1)
      * Math.max(0, ...move.matchups.map(target => target.multiplier ?? 0));
    const move = slot.moves.filter(m => !m.disabled && (!m.targetRequired || m.targets.some(t => t.location > 0)))
      .sort((a, b) => score(b) - score(a))[0];
    const effectiveness = target => move.matchups.find(match => match.location === target.location)?.multiplier ?? 0;
    const target = move.targetRequired ? move.targets.filter(t => t.location > 0)
      .sort((a, b) => effectiveness(b) - effectiveness(a))[0].location : 0;
    return { kind: 'move', index: move.index, target };
  });
}

test('the reference engine initializes every singles and doubles opponent', () => {
  assert.equal(encounters.singles.length, 27);
  assert.equal(encounters.doubles.length, 14);
  const team = practiceTeam();
  for (const mode of ['singles', 'doubles']) {
    const doubles = mode === 'doubles';
    for (const opponent of encounters[mode]) {
      const engine = new OwnedBattle(mode, [team, opponent.team], seed(), {
        profile: 'challenge', automaticOpponent: true, expectedPolicyRevision: policyRevision[mode],
        resources: [freshResources(team.slice(0, doubles ? 4 : 6)), null],
        ...(doubles ? { challengeBattleSize: 4 } : {}),
      });
      engine.runCPU();
      assert.equal(engine.frame(0).waiting, false, opponent.id);
      assert.equal(engine.frame(0).foe.length, doubles ? 2 : 1, opponent.id);
    }
  }
});

test('singles and doubles checkpoints replay independently, reject stale and illegal turns, and continue', async t => {
  const { dir, store } = await fixture(t);
  const initial = {};
  const saved = {};
  for (const mode of ['singles', 'doubles']) {
    const view = await store.start(mode, practiceTeam(), true);
    initial[mode] = view;
    assert.equal(view.frame.slots.length, mode === 'singles' ? 1 : 2);
    const actions = play(view);
    if (mode === 'doubles') {
      assert.equal(view.frame.own.length, 4);
      assert.ok(actions.some(action => action.target > 0));
    }
    saved[mode] = await store.choose(mode, view.checkpoint, actions);
    assert.notEqual(saved[mode].checkpoint, view.checkpoint);
  }
  const reopened = new ChallengeStore(dir, seed);
  for (const mode of ['singles', 'doubles']) {
    const view = await reopened.resume(mode);
    assert.deepEqual(view, saved[mode]);
    await assert.rejects(reopened.start(mode, practiceTeam(), true), /진행 중/);
    const path = join(dir, `challenge-${mode}-v1.json`);
    const before = await readFile(path, 'utf8');
    await assert.rejects(reopened.choose(mode, initial[mode].checkpoint, play(view)), /지난 턴/);
    await assert.rejects(reopened.choose(mode, view.checkpoint, view.frame.slots.map(() => ({ kind: 'switch', index: 99 }))));
    assert.equal(await readFile(path, 'utf8'), before);
    assert.deepEqual(await reopened.resume(mode), view);
    const actions = play(view);
    const results = await Promise.allSettled([
      reopened.choose(mode, view.checkpoint, actions), reopened.choose(mode, view.checkpoint, actions),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    const lost = await reopened.surrender(mode);
    assert.equal(lost.phase, 'lost');
    assert.deepEqual(await new ChallengeStore(dir).resume(mode), lost);
  }
});

for (const mode of ['singles', 'doubles']) {
  test(`${mode} victory restores its recovery screen and carries HP and PP to the next opponent once`, async t => {
    const { dir, store } = await fixture(t);
    const example = practiceTeam();
    const team = mode === 'singles' ? example : [example[2], example[3], example[0], example[1], example[4], example[5]];
    let view = await store.start(mode, team, true);
    for (let step = 0; step < 30 && view.phase === 'battling'; step++) {
      view = await store.choose(mode, view.checkpoint, play(view));
    }
    assert.equal(view.phase, 'reward');
    assert.ok(view.rewards.some(reward => reward.kind === 'pp'));
    const reopened = new ChallengeStore(dir, seed);
    assert.deepEqual(await reopened.resume(mode), view);
    const next = await reopened.advance(mode, 'pp', view.checkpoint);
    assert.equal(next.encounter, 2);
    assert.equal(next.opponent, mode === 'singles' ? '비상' : '이슬');
    const saved = JSON.parse(await readFile(join(dir, `challenge-${mode}-v1.json`), 'utf8'));
    for (const member of view.frame.own) {
      assert.equal(saved.resources.find(resource => resource.id === member.id).hp, member.hp);
    }
    const first = freshResources(team);
    assert.ok(saved.resources.some(resource => resource.moves.some((move, index) =>
      move.pp < first.find(previous => previous.id === resource.id).moves[index].maxPP)));
    await assert.rejects(reopened.advance(mode, 'pp', view.checkpoint), /선택할 수 없는/);
    assert.deepEqual(await new ChallengeStore(dir).resume(mode), next);
  });
}

test('a broken battle checkpoint cannot be silently overwritten and leaves companion data intact', async t => {
  const { dir, store } = await fixture(t);
  const path = join(dir, 'challenge-doubles-v1.json');
  const companion = join(dir, 'companion-v1.json');
  await writeFile(path, '{broken');
  await writeFile(companion, 'existing companion data');
  await assert.rejects(store.resume('doubles'), /저장 파일은 보존/);
  await assert.rejects(store.start('doubles', practiceTeam(), true), /저장 파일은 보존/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
  assert.equal(await readFile(companion, 'utf8'), 'existing companion data');
});

test('owned challenge members retain saved level and valid profile and exclude active companions', () => {
  const item = { id: 'own-6', stage: 0, level: 60, nature: 'Modest', shiny: true,
    macProfile: { abilityName: 'Blaze', moves: [{ name: 'flamethrower' }], ivs: { hp: 7 } } };
  const entry = { active: false, item, route: [{ number: 6, name: '리자몽' }] };
  const member = ownedMember(entry);
  assert.equal(member.level, 60);
  assert.equal(member.ivs.hp, 7);
  assert.equal(member.shiny, true);
  assert.deepEqual(member.moves, ['flamethrower']);
  assert.throws(() => ownedMember({ ...entry, active: true }), /졸업/);
});
