// Build directly from the reference Mac sources, without modifying that checkout.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = resolve(process.argv[2] ?? '../PokeTokenBar');
const output = resolve(process.argv[3] ?? '/private/tmp/poketokenbar-runtime-parity');
await mkdir(output, { recursive: true });
const file = await readFile(join(source, 'Sources/PokeTokenBar/UI/SpriteAnimation.swift'), 'utf8');
const portable=process.platform!=='darwin';
const start = file.indexOf(portable?'static func capFrameRate(':'enum GIFDecoder {');
let depth = 1, end = file.indexOf('{', start) + 1;
while (depth) { const char = file[end++]; if (char === '{') depth++; if (char === '}') depth--; }
// The fixtures use only frame identities and durations, not image decoding or drawing.
const imports=portable?'import Foundation\nstruct NSSize {let width:Int;let height:Int}\nfinal class NSImage {init(size:NSSize){}}\nenum GIFDecoder {':'import AppKit\nimport ImageIO\n';
await writeFile(join(output, 'GIFDecoder.swift'), imports + file.slice(start, end)+(portable?'\n}':''));
const statusPath=join(output,'ProviderStatusChecker.swift');
await writeFile(statusPath,(portable?'import FoundationNetworking\n':'')+await readFile(join(source,'Sources/PokeTokenBar/Core/ProviderStatusChecker.swift'),'utf8'));
const oraclePath=join(output,'RuntimeOracle.swift');
const harness=await readFile(resolve('tests/macos-runtime-oracle.swift'),'utf8');
await writeFile(oraclePath,portable?harness.replace('import AppKit',''):harness);
execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', join(output, 'module-cache'),
  join(source, 'Sources/PokeTokenBar/Core/AgentActivity.swift'),
  statusPath, join(output, 'GIFDecoder.swift'),
  oraclePath, '-o', join(output, 'oracle')], { stdio: 'inherit' });
console.log(join(output, 'oracle'));
