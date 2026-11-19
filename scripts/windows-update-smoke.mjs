// Real installs on a CI runner: signed in-app update (installer → installer) and ZIP folder → Setup.exe handoff.
// Usage: `generate-key <private.pem>` prints the raw public key; `<baseDir> <updateDir>` runs both scenarios.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import electronBinary from 'electron';

const rawPublicKey = publicKey => Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');

if (process.argv[2] === 'generate-key') {
  const privateKeyPath = process.argv[3];
  assert.ok(privateKeyPath, 'generate-key needs a private key output path');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // Test-only key for the 127.0.0.1 QA feed; it is never committed or used for releases.
  await writeFile(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  process.stdout.write(rawPublicKey(publicKey));
  process.exit(0);
}

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const [baseDir, updateDir] = process.argv.slice(2);
const privateKeyPath = process.env.POKE_UPDATE_QA_PRIVATE_KEY_FILE;
assert.ok(baseDir && updateDir && privateKeyPath && process.env.APPDATA && process.env.RUNNER_TEMP);
const execute = promisify(execFile);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const data = join(process.env.APPDATA, 'PokeTokenBar Windows');
const save = join(data, 'companion-v1.json');
const settingsFile = join(data, 'settings-v1.json');
const portFile = join(data, 'DevToolsActivePort');
const installDir = join(process.env.RUNNER_TEMP, '포켓 토큰 설치');
const installed = join(installDir, 'PokeTokenBar.exe');
const uninstaller = join(installDir, 'Uninstall PokeTokenBar.exe');
const zipFolder = join(process.env.RUNNER_TEMP, '포켓 토큰 압축 폴더');
const unpacked = join(zipFolder, 'PokeTokenBar.exe');
const startMenu = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const installerShortcut = join(startMenu, 'PokeTokenBar Windows.lnk');
const zipShortcut = join(startMenu, 'PokeTokenBar Windows ZIP.lnk');
const startupName = 'com.poketokenbar.windows';

// Runs PowerShell with UTF-8 output so Korean install paths survive; values are passed through env only.
async function powershell(command, values = {}) {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + command], { env: { ...process.env, ...values } });
  return stdout.trim();
}

async function processesAt(executable, stop = false) {
  const filter = "Get-CimInstance Win32_Process -Filter \"Name='PokeTokenBar.exe'\" | Where-Object { $_.ExecutablePath -eq $env:POKE_TEST_EXE }";
  return powershell(filter + (stop ? ' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' : ' | Select-Object -ExpandProperty ProcessId'),
    { POKE_TEST_EXE: executable });
}

const startupEntry = () => powershell("(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $env:POKE_NAME -ErrorAction SilentlyContinue).$env:POKE_NAME", { POKE_NAME: startupName });
const protocolCommand = () => powershell("$key = Get-Item -LiteralPath 'HKCU:\\Software\\Classes\\poketokenbar\\shell\\open\\command' -ErrorAction SilentlyContinue; if ($key) { $key.GetValue('') }");
// WScript.Shell turns non-ANSI path characters into '?', so shortcuts go through Electron's Unicode shell API.
const shortcutHelper = fileURLToPath(new URL('./shortcut-link.cjs', import.meta.url));
const shortcutLink = async (...args) => (await execute(electronBinary, [shortcutHelper, ...args])).stdout.trim();
const shortcutTarget = path => shortcutLink('read', path);
const createShortcut = (path, target) => shortcutLink('write', path, target);
const executableVersion = executable => powershell('(Get-Item -LiteralPath $env:POKE_TEST_EXE).VersionInfo.ProductVersion', { POKE_TEST_EXE: executable });
const mentions = (text, executable) => text.toLowerCase().includes(executable.toLowerCase());

async function assertLaunchRegistrations(executable, shortcuts) {
  const startup = await startupEntry();
  assert.ok(mentions(startup, '"' + executable + '"') && startup.includes('--login-start'), 'login item: ' + startup);
  const protocol = await protocolCommand();
  assert.ok(mentions(protocol, '"' + executable + '"'), 'poketokenbar protocol: ' + protocol);
  for (const shortcut of shortcuts) assert.equal((await shortcutTarget(shortcut)).toLowerCase(), executable.toLowerCase(), 'shortcut: ' + shortcut);
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

const sha256File = async path => createHash('sha256').update(await readFile(path)).digest('hex');

async function manifest(directory) {
  const bytes = await readFile(join(directory, 'latest.yml'));
  const yaml = bytes.toString('utf8');
  const version = yaml.match(/^version: ([\d.]+)\s*$/m)?.[1];
  const file = yaml.match(/^path: (PokeTokenBar-Windows-[\d.]+-x64-Setup\.exe)\s*$/m)?.[1];
  const expected = yaml.match(/^sha512: ([A-Za-z0-9+/=]+)\s*$/m)?.[1];
  assert.ok(version && file && expected, yaml);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(join(directory, file))) hash.update(chunk);
  assert.equal(hash.digest('base64'), expected);
  return { version, file, bytes };
}

const base = await manifest(baseDir);
const update = await manifest(updateDir);
assert.notEqual(base.version, update.version);
await access(join(baseDir, 'win-unpacked', 'PokeTokenBar.exe'));

// Signs the raw latest.yml bytes exactly as `pnpm release:sign` does for real releases.
const privateKey = createPrivateKey(await readFile(privateKeyPath));
const signature = sign(null, update.bytes, privateKey).toString('base64');
assert.ok(verify(null, update.bytes, createPublicKey(privateKey), Buffer.from(signature, 'base64')));
assert.equal(rawPublicKey(createPublicKey(privateKey)), process.env.POKE_UPDATE_QA_PUBLIC_KEY, 'QA builds must embed this public key');

const downloads = new Set();
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname.slice(1));
    if (name === 'latest.yml.sig') {
      downloads.add(name);
      response.writeHead(200, { 'Content-Length': Buffer.byteLength(signature) }).end(signature);
      return;
    }
    if (name !== basename(name) || !['latest.yml', update.file].includes(name)) {
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

// Starts an executable with a debugging port and returns its process, port, main target and settings page.
async function launchWithSettings(executable) {
  await rm(portFile, { force: true });
  const child = spawn(executable, ['--show', '--remote-debugging-port=0'], { stdio: 'ignore' });
  child.on('error', error => console.error(error));
  const port = await until('debugging port of ' + executable, async () => Number((await readFile(portFile, 'utf8')).split('\n')[0]));
  const mainTarget = await until('main window', async () => (await targetList(port)).find(row => row.url.endsWith('/index.html')));
  const mainPage = await openPage(mainTarget);
  await mainPage.evaluate('window.desktop.openSettings()');
  mainPage.close();
  const settingsTarget = await until('settings window', async () => (await targetList(port)).find(row => row.url.endsWith('/settings.html')));
  const settingsPage = await openPage(settingsTarget);
  await until('desktop settings', () => settingsPage.evaluate("!document.querySelector('#desktop-settings').hidden"));
  return { child, port, mainTarget, settingsPage };
}

const petVisible = async port => {
  const pet = await until('floating pet window', async () => (await targetList(port)).find(row => row.url.endsWith('/pet.html')));
  const petPage = await openPage(pet);
  try { await until('visible floating pet', () => petPage.evaluate("document.visibilityState === 'visible'")); } finally { petPage.close(); }
};

// Runs a Setup.exe silently; `--force-run` reproduces runAfterFinish of an interactive oneClick install.
async function runInstaller(installer, forceRun) {
  const child = spawn(installer, ['/S', ...(forceRun ? ['--force-run'] : []), '/D=' + installDir], { windowsVerbatimArguments: true, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, 'installer exit code');
  await until('installed executable', async () => { await access(installed); return true; }, 120000);
}

async function stopAll() {
  for (const executable of [installed, unpacked]) {
    await processesAt(executable, true).catch(() => {});
    await until('processes stopped at ' + executable, async () => !(await processesAt(executable)));
  }
}

// Relaunches the updated install with a debugger and checks version, saves, settings and pet restoration.
async function verifyUpdatedInstall(expected) {
  await stopAll();
  const session = await launchWithSettings(installed);
  try {
    const { settingsPage, mainTarget, port } = session;
    assert.equal(await settingsPage.evaluate("document.querySelector('#desktop-version').textContent"), update.version);
    assert.equal(await settingsPage.evaluate('window.usage.companion().then(state => state.progress)'), 2_400_000);
    assert.equal(await sha256File(save), expected.saveHash);
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), expected.settings);
    await petVisible(port);
    for (const [mode, battle] of expected.battles) {
      assert.equal(await sha256File(battle.path), battle.hash);
      const mainPage = await openPage(mainTarget);
      try { assert.deepEqual(await mainPage.evaluate(`window.battle.resume('${mode}')`), battle.view); } finally { mainPage.close(); }
    }
  } finally { session.settingsPage.close(); }
}

let session;
try {
  // Scenario 1: installed 1.0.n → update button → signed 1.0.n+1 replaces it and restarts.
  await runInstaller(join(baseDir, base.file), false);
  await access(uninstaller);
  await mkdir(data, { recursive: true });
  const original = Buffer.from(JSON.stringify({
    version: 1, baseline: 1, ledger: {}, raised: 2_400_000,
    progress: 2_400_000, active: null, graduated: [],
  }));
  await writeFile(save, original, { flag: 'wx' });
  session = await launchWithSettings(installed);
  const evaluate = expression => session.settingsPage.evaluate(expression);
  const click = id => evaluate("document.getElementById('" + id + "').click()");
  assert.equal(await evaluate("document.querySelector('#desktop-version').textContent"), base.version);
  assert.equal(await evaluate('window.usage.companion().then(state => state.progress)'), 2_400_000);
  await click('desktop-login');
  await until('auto-start enabled', () => evaluate("!document.querySelector('#desktop-login').disabled && document.querySelector('#desktop-login').checked"));
  await click('desktop-pet');
  await petVisible(session.port);
  await until('pet preference saved', async () => JSON.parse(await readFile(settingsFile, 'utf8')).petEnabled === true);
  await assertLaunchRegistrations(installed, [installerShortcut]);

  const battles = new Map();
  // Practice challenges open in preparation; only singles can begin through the CPU prepare command.
  for (const mode of ['singles']) {
    const mainPage = await openPage(session.mainTarget);
    const result = await mainPage.evaluate(`(async () => {
      const prepared = await window.battle.start('${mode}', null);
      const initial = prepared.phase === 'preparation'
        ? await window.battle.cpu('prepare', { order: prepared.progress.team.map(member => member.id), begin: true })
        : prepared;
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
    battles.set(mode, { path, hash: await sha256File(path), view: result.next });
  }

  // Checks through IPC (startup may already have checked), then installs through the real button.
  const available = await until('signed update available', async () => {
    const state = await evaluate('window.desktop.checkUpdate()');
    return state.state === 'available' && state.version === update.version && state;
  });
  await until('install button shown', () => evaluate("!document.querySelector('#desktop-update-skip').hidden && !document.querySelector('#desktop-update').disabled"));
  assert.equal(available.delivery, 'installer');
  assert.ok(downloads.has('latest.yml') && downloads.has('latest.yml.sig'));
  const expected = { saveHash: await sha256File(save), settings: JSON.parse(await readFile(settingsFile, 'utf8')), battles };
  assert.deepEqual(await readFile(save), original);
  // Do not await IPC here: a successful installation closes the renderer.
  await evaluate("setTimeout(() => document.querySelector('#desktop-update').click(), 250); true");
  await until('installed app exited for the update', () => session.child.exitCode !== null, 180000);
  session.settingsPage.close();
  assert.ok(downloads.has(update.file));
  await until('updated executable version', async () => (await executableVersion(installed)).startsWith(update.version), 120000);
  console.log('Updated app process IDs:', await until('updated app relaunched', () => processesAt(installed), 60000));
  await until('launch registrations kept on the new executable', async () => { await assertLaunchRegistrations(installed, [installerShortcut]); return true; });
  assert.equal(await sha256File(save), expected.saveHash);
  await verifyUpdatedInstall(expected);
  console.log('PASS: signed in-app update ' + base.version + ' → ' + update.version + ' kept saves, settings, pet, login item, shortcut and protocol');

  // Scenario 2: ZIP folder build 1.0.n running → user runs Setup.exe 1.0.n+1 → installed app takes over.
  await stopAll();
  const uninstalling = spawn(uninstaller, ['/S'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { uninstalling.once('error', reject); uninstalling.once('exit', resolve); });
  await until('installed build removed', async () => { try { await access(installed); return false; } catch { return true; } }, 120000);
  await rm(installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  await cp(join(baseDir, 'win-unpacked'), zipFolder, { recursive: true });
  session = await launchWithSettings(unpacked);
  const zipEvaluate = expression => session.settingsPage.evaluate(expression);
  assert.equal(await zipEvaluate("document.querySelector('#desktop-version').textContent"), base.version);
  if (!(await zipEvaluate("document.querySelector('#desktop-login').checked"))) {
    await zipEvaluate("document.getElementById('desktop-login').click()");
  }
  await until('ZIP build auto-start enabled', async () => mentions(await startupEntry(), '"' + unpacked + '"'));
  await petVisible(session.port);
  await createShortcut(zipShortcut, unpacked);
  await assertLaunchRegistrations(unpacked, [zipShortcut]);
  const zipExpected = { saveHash: await sha256File(save), settings: JSON.parse(await readFile(settingsFile, 'utf8')), battles };
  session.settingsPage.close();
  await runInstaller(join(updateDir, update.file), true);
  await until('ZIP build handed off', async () => !(await processesAt(unpacked)), 120000);
  await until('installed app took over', () => processesAt(installed), 60000);
  await until('launch registrations moved to the installed executable', async () => {
    await assertLaunchRegistrations(installed, [zipShortcut, installerShortcut]);
    return true;
  }, 60000);
  assert.equal(await sha256File(save), zipExpected.saveHash);
  await verifyUpdatedInstall(zipExpected);
  console.log('PASS: ZIP folder ' + base.version + ' → Setup.exe ' + update.version + ' handoff kept saves, settings, pet, login item, shortcuts and protocol');
} finally {
  session?.settingsPage.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await stopAll().catch(() => {});
  await rm(zipShortcut, { force: true }).catch(() => {});
}
