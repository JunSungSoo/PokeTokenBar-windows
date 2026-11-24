import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { chatExportProviders, type Provider } from '../../shared/usage.js';
import { tokens, type Entry } from './entries.js';
import { object, timestamp, type Row } from './jsonl.js';

type ChatExportProvider = typeof chatExportProviders[number];
const maxArchiveBytes = 128 * 1024 * 1024;
const cache = new Map<string, { size: number; modified: number; since: number; entries: Entry[] }>();
const blockTags = new Set(['br', 'div', 'p', 'li', 'tr', 'td', 'th', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function isChatExportProvider(provider: Provider): provider is ChatExportProvider {
  return chatExportProviders.some(id => id === provider);
}

function textParts(parts: unknown, extract: (part: unknown) => unknown): string {
  return Array.isArray(parts)
    ? parts.map(extract).filter((text): text is string => typeof text === 'string' && Boolean(text.trim())).join('\n')
    : '';
}

function estimateText(text: string): number {
  // This approximation uses visible text only and weights multibyte scripts more than ASCII.
  return Math.ceil(Buffer.byteLength(text.trim(), 'utf8') / 4);
}

function chatEntry(provider: ChatExportProvider, id: unknown, time: number | undefined,
  role: 'user' | 'assistant', rawText: string, model: unknown, since: number): Entry | undefined {
  if (typeof id !== 'string' || !id || time === undefined || time < since) return;
  const estimate = estimateText(rawText);
  if (!estimate) return;
  return {
    id: provider + '|' + id,
    time,
    tokens: role === 'user' ? tokens(estimate) : tokens(0, estimate),
    model: typeof model === 'string' && model ? model : undefined,
    costUnavailable: true,
  };
}

function claudeEntry(message: Row, since: number): Entry | undefined {
  const role = message.sender === 'human' ? 'user' : message.sender;
  if (role !== 'user' && role !== 'assistant') return;
  const content = textParts(message.content, part => {
    const block = object(part);
    return block?.type === 'text' ? block.text : undefined;
  });
  const text = content || (typeof message.text === 'string' ? message.text : '');
  return chatEntry('claude-chat', message.uuid, timestamp(message.created_at), role, text, undefined, since);
}

function chatgptEntry(node: Row, since: number): Entry | undefined {
  const message = object(node.message);
  if (!message) return;
  const role = object(message.author)?.role;
  if (role !== 'user' && role !== 'assistant') return;
  const metadata = object(message.metadata);
  if (metadata?.is_visually_hidden_from_conversation || (role === 'assistant' && message.recipient && message.recipient !== 'all')) return;
  const content = object(message.content);
  if (content?.content_type !== 'text' && content?.content_type !== 'multimodal_text') return;
  const creation = message.create_time;
  const time = typeof creation === 'number' && Number.isFinite(creation) && creation > 0 ? creation * 1000 : undefined;
  return chatEntry('chatgpt-chat', message.id ?? node.id, time, role,
    textParts(content.parts, part => part), metadata?.model_slug, since);
}

function responseText(html: string): string {
  const parts: string[] = [];
  const pending: Array<DefaultTreeAdapterTypes.ChildNode | string> = [...parseFragment(html).childNodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (typeof node === 'string') parts.push(node);
    else if ('value' in node) parts.push(node.value);
    else if ('tagName' in node && node.tagName !== 'script' && node.tagName !== 'style') {
      if (blockTags.has(node.tagName)) {
        parts.push(' ');
        pending.push(' ');
      }
      for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]);
    }
  }
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

function geminiEntry(row: Row, since: number): Entry | undefined {
  if (typeof row.header === 'string' && !/^(?:gemini(?: apps)?|bard)$/i.test(row.header.trim())) return;
  const prefix = 'Prompted ';
  if (typeof row.title !== 'string' || !row.title.startsWith(prefix)) return;
  const time = timestamp(row.time);
  if (time === undefined || time < since) return;
  const prompt = row.title.slice(prefix.length).trim();
  const response = textParts(row.safeHtmlItem, part => {
    const html = object(part)?.html;
    return typeof html === 'string' ? responseText(html) : undefined;
  });
  const counts = tokens(estimateText(prompt), estimateText(response));
  if (!counts.total) return;
  const key = createHash('sha256').update(JSON.stringify([time, prompt])).digest('hex');
  return { id: 'gemini-takeout|' + key, time, tokens: counts, costUnavailable: true };
}

export async function readChatExport(provider: ChatExportProvider, path: string, since: number): Promise<Entry[]> {
  const file = await open(path, 'r');
  try {
    const { size, mtimeMs } = await file.stat();
    if (size > maxArchiveBytes) throw new Error('Chat export exceeds 128 MiB');
    const key = provider + '|' + path;
    const previous = cache.get(key);
    if (previous && previous.size === size && previous.modified === mtimeMs && previous.since === since) return previous.entries;
    const conversations: unknown = JSON.parse((await file.readFile('utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(conversations)) throw new Error('Expected a chat conversations array');
    const entries: Entry[] = [];
    for (const value of conversations) {
      const conversation = object(value);
      if (!conversation) continue;
      if (provider === 'gemini-takeout') {
        const entry = geminiEntry(conversation, since);
        if (entry) entries.push(entry);
        continue;
      }
      const mapping = object(conversation.mapping);
      const messages = provider === 'claude-chat'
        ? Array.isArray(conversation.chat_messages) ? conversation.chat_messages : []
        : mapping ? Object.values(mapping) : [];
      for (const item of messages) {
        const message = object(item);
        if (!message) continue;
        const entry = provider === 'claude-chat' ? claudeEntry(message, since) : chatgptEntry(message, since);
        if (entry) entries.push(entry);
      }
    }
    cache.delete(key);
    cache.set(key, { size, modified: mtimeMs, since, entries });
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    return entries;
  } finally {
    await file.close();
  }
}
