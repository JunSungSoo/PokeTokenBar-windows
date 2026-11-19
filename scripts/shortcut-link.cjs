// Reads or writes a .lnk through Electron's Unicode shell API: `electron shortcut-link.cjs read <lnk>` | `write <lnk> <target>`.
const { app, shell } = require('electron');
app.whenReady().then(() => {
  const [action, link, target] = process.argv.slice(2);
  const output = action === 'write' ? String(shell.writeShortcutLink(link, 'create', { target })) : shell.readShortcutLink(link).target;
  process.stdout.write(output, () => app.exit(output === 'false' ? 1 : 0));
}).catch(error => { console.error(error); app.exit(1); });
