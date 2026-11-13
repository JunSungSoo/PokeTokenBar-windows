// Build directly from the reference Mac sources, without modifying that checkout.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = resolve(process.argv[2] ?? '../PokeTokenBar');
const output = resolve(process.argv[3] ?? '/private/tmp/poketokenbar-runtime-parity');
await mkdir(output, { recursive: true });
const file = await readFile(join(source, 'Sources/PokeTokenBar/UI/SpriteAnimation.swift'), 'utf8');
const start = file.indexOf('enum GIFDecoder {');
let depth = 1, end = file.indexOf('{', start) + 1;
while (depth) { const char = file[end++]; if (char === '{') depth++; if (char === '}') depth--; }
await writeFile(join(output, 'GIFDecoder.swift'), 'import AppKit\nimport ImageIO\n' + file.slice(start, end));
execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', join(output, 'module-cache'),
  join(source, 'Sources/PokeTokenBar/Core/AgentActivity.swift'),
  join(source, 'Sources/PokeTokenBar/Core/ProviderStatusChecker.swift'), join(output, 'GIFDecoder.swift'),
  resolve('tests/macos-runtime-oracle.swift'), '-o', join(output, 'oracle')], { stdio: 'inherit' });
console.log(join(output, 'oracle'));
