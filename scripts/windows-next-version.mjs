import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../package.json', import.meta.url);
const metadata = JSON.parse(await readFile(path, 'utf8'));
const parts = metadata.version.split('.').map(Number);
if (parts.length !== 3 || parts.some(part => !Number.isSafeInteger(part) || part < 0)) {
  throw new Error('Expected a stable version for the Windows smoke build');
}
parts[2]++;
metadata.version = parts.join('.');
await writeFile(path, JSON.stringify(metadata, null, 2) + '\n');
