import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { cp, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = join(project, 'src');
const dist = join(project, 'dist');
const reloadDirectory = await mkdtemp(join(tmpdir(), 'ptb-dev-'));
const reloadFile = join(reloadDirectory, 'command');
await writeFile(reloadFile, '');

let electron;
let building = false;
let closing = false;
let timer;
const pending = new Set(['']);

function exited(child) {
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', () => resolve(1));
  });
}

function startElectron() {
  const child = spawn(electronPath, ['.', '--show', ...process.argv.slice(2)], {
    cwd: project, stdio: 'inherit',
    env: {
      ...process.env,
      PTB_STATE_DIR: process.env.PTB_STATE_DIR || join(process.env.LOCALAPPDATA || tmpdir(), 'PokeTokenBar Windows Dev'),
      PTB_DEV_RELOAD_FILE: reloadFile,
    },
  });
  const done = exited(child);
  electron = { child, done };
  void done.then(code => {
    if (electron?.child === child) electron = undefined;
    if (code) console.error('[dev] Electron exited. A source change will retry the launch.');
  });
}

async function stopElectron() {
  if (!electron) return;
  const { child, done } = electron;
  await writeFile(reloadFile, 'quit');
  const timeout = setTimeout(() => child.kill(), 4000);
  try { await done; } finally { clearTimeout(timeout); }
}

async function syncRenderer(edits) {
  const renderer = join(dist, 'renderer');
  for (const edit of edits) {
    const destination = resolve(dist, edit);
    if (destination.startsWith(renderer + sep) && !existsSync(join(source, edit))) {
      await rm(destination, { recursive: true, force: true });
    }
  }
  await cp(join(source, 'renderer'), renderer, { recursive: true });
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 150);
}

async function rebuild() {
  if (building || closing) return;
  building = true;
  const edits = [...pending];
  pending.clear();
  try {
    if (electron && edits.every(edit => edit.startsWith('renderer/'))) {
      await syncRenderer(edits);
      if (closing) return;
      await writeFile(reloadFile, 'reload');
      console.log('[dev] Renderer reloaded.');
    } else {
      const build = spawn('pnpm build', { cwd: project, shell: true, stdio: 'inherit' });
      if (await exited(build) !== 0) {
        console.error('[dev] Build failed. Listening for the next source change.');
        return;
      }
      await stopElectron();
      if (!closing) {
        await writeFile(reloadFile, '');
        startElectron();
      }
    }
  } catch (error) {
    if (!closing) console.error('[dev] Reload failed:', error);
  } finally {
    building = false;
    if (pending.size && !closing) schedule();
  }
}

const watcher = watch(source, { recursive: true }, (_event, name) => {
  pending.add(name?.replaceAll('\\', '/') ?? '');
  schedule();
});
watcher.on('error', error => console.error('[dev] Source watcher failed:', error));

async function stop() {
  if (closing) return;
  closing = true;
  watcher.close();
  clearTimeout(timer);
  await stopElectron();
  await rm(reloadFile, { force: true });
  await rmdir(reloadDirectory);
}
process.on('SIGINT', () => void stop().catch(console.error));
process.on('SIGTERM', () => void stop().catch(console.error));

await rebuild();
