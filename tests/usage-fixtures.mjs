import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const referenceTime = '2026-06-17T03:00:00Z';
const now = new Date(referenceTime);
const today = '2026-06-17T01:00:00Z';
const beforeLocalMidnight = '2026-06-16T14:59:00Z';
const pastWeek = '2026-06-04T00:00:00Z';

export async function writeLog(root, name, lines, modified = now) {
  const file = join(root, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\r\n'));
  await utimes(file, modified, modified);
}

const vector = (input, cached, output, total = input + output) =>
  ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: total });
const meta = (id, forked_from_id) => ({ type: 'session_meta', payload: { id, forked_from_id } });
const count = (timestamp, last, cumulative) => ({
  timestamp, type: 'event_msg', payload: {
    type: 'token_count', info: { last_token_usage: last, total_token_usage: cumulative },
  },
});
const assistant = (timestamp, id, input, output, write, read) => ({
  timestamp, type: 'assistant', requestId: 'request-a', message: {
    id, model: 'claude-sonnet-4-6', usage: {
      input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read,
    },
  },
});

export async function createLogs(base) {
  const codex = join(base, 'Codex 로그 폴더');
  const claude = join(base, 'Claude 로그 폴더');
  const empty = join(base, '빈 폴더');
  await mkdir(empty, { recursive: true });

  const first = vector(100, 40, 10);
  const second = vector(140, 50, 15);
  const parent = [meta('session-a'), count(beforeLocalMidnight, first, first),
    count(today, vector(40, 10, 5), second), '{bad json', count(today, vector(40, 10, 5), second)];
  await writeLog(codex, 'sessions/rollout-session-a.jsonl', parent);
  await writeLog(codex, 'archived_sessions/rollout-session-a-copy.jsonl', parent);
  await writeLog(codex, 'sessions/rollout-session-b.jsonl', [
    meta('session-b', 'session-a'), count(today, first, first), count(today, vector(40, 10, 5), second),
    count(today, vector(0, 0, 0, 12), vector(140, 50, 15, 167)),
  ]);
  await writeLog(codex, 'sessions/rollout-old.jsonl', [meta('old'), count(pastWeek, vector(5, 0, 1))]);

  await writeLog(claude, 'project a/chat.jsonl', [
    assistant(beforeLocalMidnight, 'message-a', 5, 1, 10, 20),
    assistant(today, 'message-b', 2, 8, 0, 0), '{broken', assistant(pastWeek, 'message-old', 5, 0, 0, 0),
  ]);
  await writeLog(claude, 'project a/chat/subagents/side.jsonl', [
    assistant(today, 'message-a', 5, 15, 10, 20), assistant(today, 'message-b', 2, 5, 0, 0),
  ]);
  return { codex, claude, empty };
}
