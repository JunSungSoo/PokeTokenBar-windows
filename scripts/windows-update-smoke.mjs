import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const [baseDir, updateDir] = process.argv.slice(2);
assert.ok(baseDir && updateDir && process.env.APPDATA && process.env.RUNNER_TEMP);
const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const data = join(process.env.APPDATA, 'PokeTokenBar Windows');
const save = join(data, 'companion-v1.json');
const portFile = join(data, 'DevToolsActivePort');
const installDir = join(process.env.RUNNER_TEMP, '포켓 토큰 설치');
const installed = join(installDir, 'PokeTokenBar.exe');
const startupKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const startupName = 'com.poketokenbar.windows';

async function installedProcesses(stop = false) {
  const filter = "Get-CimInstance Win32_Process -Filter \"Name='PokeTokenBar.exe'\" | Where-Object { $_.ExecutablePath -eq $env:POKE_TEST_EXE }";
  const command = filter + (stop ? ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' : ' | Select-Object -ExpandProperty ProcessId');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { env: { ...process.env, POKE_TEST_EXE: installed } });
  return stdout.trim();
}


async function until(label, read, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { last = error; }
    await pause(250);
  }
  throw new Error('Timed out: ' + label, { cause: last });
}

async function manifest(dir) {
  const yaml = await readFile(join(dir, 'latest.yml'), 'utf8');
  const version = yaml.match(/^version: ([\d.]+)\s*$/m)?.[1];
  const file = yaml.match(/^path: (PokeTokenBar-Windows-[\d.]+-x64-Setup\.exe)\s*$/m)?.[1];
  const expected = yaml.match(/^sha512: ([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  assert.ok(version && file && expected, yaml);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(join(dir, file))) hash.update(chunk);
  assert.equal(hash.digest('base64'), expected);
  await access(join(dir, file + '.blockmap'));
  return { version, file };
}

const base = await manifest(baseDir);
const update = await manifest(updateDir);
assert.notEqual(base.version, update.version);
const downloads = new Set();
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1));
    if (name !== basename(name) || !['latest.yml', update.file, update.file + '.blockmap'].includes(name)) {
      response.writeHead(404).end();
      return;
    }
    const file = join(updateDir, name);
    const { size } = await stat(file);
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Number(range[2]) : size - 1;
    if (start > end || end >= size) { response.writeHead(416).end(); return; }
    downloads.add(name);
    response.writeHead(range ? 206 : 200, {
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size } : {}),
    });
    const stream = createReadStream(file, { start, end });
    response.on('close', () => stream.destroy());
    stream.on('error', error => response.destroy(error));
    stream.pipe(response);
  } catch { response.writeHead(500).end(); }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(4173, '127.0.0.1', resolve);
});

function targetList(port) {
  return fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) }).then(result => result.json());
}

async function openPage(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  return {
    close: () => socket.close(),
    evaluate(expression) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.removeEventListener('message', receive);
          reject(new Error('CDP evaluation timed out: ' + expression));
        }, 10000);
        function receive(event) {
          const packet = JSON.parse(event.data);
          if (packet.id !== id) return;
          clearTimeout(timer);
          socket.removeEventListener('message', receive);
          if (packet.error || packet.result?.exceptionDetails) reject(new Error(JSON.stringify(packet)));
          else resolve(packet.result?.result?.value);
        }
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
  };
}

let page;
try {
  await execute(join(baseDir, base.file), ['/S', '/D=' + installDir], {
    windowsVerbatimArguments: true, timeout: 120000,
  });
  await access(installed);
  await mkdir(data, { recursive: true });
  const original = Buffer.from(JSON.stringify({
    version: 1, baseline: 1, ledger: {}, raised: 2_400_000,
    progress: 2_400_000, active: null, graduated: [],
  }));
  await writeFile(save, original, { flag: 'wx' });
  const running = spawn(installed, ['--show', '--remote-debugging-port=0'], { stdio: 'ignore' });
  running.on('error', error => console.error(error));
  const port = await until('Electron debugging port', async () => Number((await readFile(portFile, 'utf8')).split('\n')[0]));
  const target = await until('installed main window', async () => (await targetList(port)).find(row => row.url.endsWith('/index.html')));
  page = await openPage(target);
  await page.evaluate('window.desktop.openSettings()');
  page.close();
  const settingsTarget = await until('settings window', async () => (await targetList(port)).find(row => row.url.endsWith('/settings.html')));
  page = await openPage(settingsTarget);
  const evaluate = expression => page.evaluate(expression);
  const click = id => evaluate("document.getElementById('" + id + "').click()");
  await until('desktop settings', () => evaluate("!document.querySelector('#desktop-settings').hidden"));
  assert.equal(await evaluate("document.querySelector('#desktop-version').textContent"), base.version);
  assert.equal(await evaluate('window.usage.companion().then(state => state.progress)'), 2_400_000);

  await click('desktop-login');
  await until('auto-start enabled', () => evaluate("!document.querySelector('#desktop-login').disabled && document.querySelector('#desktop-login').checked"));
  const autoStart = async () => (await execute('reg.exe', ['query', startupKey, '/v', startupName])).stdout;
  assert.match(await autoStart(), /PokeTokenBar\.exe".*--login-start/);
  await click('desktop-pet');
  const pet = await until('floating pet window', async () => (await targetList(port)).find(row => row.url.endsWith('/pet.html')));
  const petPage = await openPage(pet);
  try {
    await until('visible floating pet', () => petPage.evaluate("document.visibilityState === 'visible'"));
    assert.equal(await petPage.evaluate("getComputedStyle(document.querySelector('.handle')).webkitAppRegion"), 'drag');
  } finally { petPage.close(); }
  await click('desktop-pet');
  await until('floating pet hidden', async () => !(await targetList(port)).some(row => row.url.endsWith('/pet.html')));

  const battles = new Map();
  for (const mode of ['singles', 'doubles']) {
    const mainPage = await openPage(target);
    const result = await mainPage.evaluate(`(async () => {
      const initial = await window.battle.start('${mode}', null);
      const actions = initial.frame.slots.map(slot => {
        const move = slot.moves.find(move => !move.disabled &&
          (!move.targetRequired || move.targets.some(target => target.location > 0)));
        return { kind: 'move', index: move.index, target: move.targets.find(target => target.location > 0)?.location ?? 0 };
      });
      const next = await window.battle.choose('${mode}', initial.checkpoint, actions);
      return { initial: initial.checkpoint, actions: actions.length, next };
    })()`);
    mainPage.close();
    assert.equal(result.actions, mode === 'singles' ? 1 : 2);
    assert.notEqual(result.next.checkpoint, result.initial);
    const path = join(data, `challenge-${mode}-v1.json`);
    battles.set(mode, { path, bytes: await readFile(path), view: result.next });
  }

  await click('desktop-update');
  await until('update available', () => evaluate("document.querySelector('#desktop-update').textContent.includes('다운로드')"));
  await click('desktop-update');
  await until('update downloaded', () => evaluate("document.querySelector('#desktop-update').textContent.includes('다시 시작')"), 180000);
  assert.ok(downloads.has('latest.yml') && downloads.has(update.file));
  const beforeUpdate = await readFile(save);
  assert.deepEqual(beforeUpdate, original);
  // Do not await IPC here: a successful installation closes the renderer.
  await evaluate("setTimeout(() => document.querySelector('#desktop-update').click(), 250); true");
  await until('first application process exited', () => running.exitCode !== null, 120000);
  const executableVersion = async () => {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:POKE_TEST_EXE).VersionInfo.ProductVersion'],
    { env: { ...process.env, POKE_TEST_EXE: installed } });
    return stdout.trim();
  };
  await until('updated executable version', async () => (await executableVersion()).startsWith(update.version), 120000);
  assert.deepEqual(await readFile(save), original);
  assert.match(await autoStart(), /PokeTokenBar\.exe".*--login-start/);

  const output = await until('updated app relaunched', () => installedProcesses());
  console.log('Updated app process IDs:', output);

  // Launch the updated binary again with a debugger to verify it can read the saved progress.
  page.close();
  page = undefined;
  await installedProcesses(true);
  await until('updated process stopped', async () => !(await installedProcesses()));
  await rm(portFile, { force: true });
  const restarted = spawn(installed, ['--show', '--remote-debugging-port=0'], { stdio: 'ignore' });
  restarted.on('error', error => console.error(error));
  const newPort = await until('updated debugging port', async () => Number((await readFile(portFile, 'utf8')).split('\n')[0]));
  const newTarget = await until('updated main window', async () => (await targetList(newPort)).find(row => row.url.endsWith('/index.html')));
  page = await openPage(newTarget);
  await page.evaluate('window.desktop.openSettings()');
  page.close();
  const newSettingsTarget = await until('updated settings window', async () => (await targetList(newPort)).find(row => row.url.endsWith('/settings.html')));
  page = await openPage(newSettingsTarget);
  await until('updated desktop settings', () => page.evaluate("!document.querySelector('#desktop-settings').hidden"));
  assert.equal(await page.evaluate("document.querySelector('#desktop-version').textContent"), update.version);
  assert.equal(await page.evaluate('window.usage.companion().then(state => state.progress)'), 2_400_000);
  assert.deepEqual(await readFile(save), original);
  for (const [mode, battle] of battles) {
    assert.deepEqual(await readFile(battle.path), battle.bytes);
    const mainPage = await openPage(newTarget);
    assert.deepEqual(await mainPage.evaluate(`window.battle.resume('${mode}')`), battle.view);
    mainPage.close();
  }
  console.log('PASS: x64 install, desktop controls, floating pet, updater relaunch, startup registration, companion and battle save retention');
} finally {
  page?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await installedProcesses(true).catch(() => {});
}
