// Reads or writes a .lnk through Electron's Unicode shell API: `electron shortcut-link.cjs read <lnk>` | `write <lnk> <target>`.
const { app, shell } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const [action, link, target] = process.argv.slice(2);
  const output = action === 'write' ? String(shell.writeShortcutLink(link, 'create', { target })) : shell.readShortcutLink(link).target;
  process.exitCode = output === 'false' ? 1 : 0;
  process.stdout.write('RESULT:' + output + '\n', () => app.quit());
}).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
