// Execute Electron tests without inheriting Codex's ELECTRON_RUN_AS_NODE.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const test = process.argv[2];
if (!test) throw new Error('Pass an Electron test script');
const result = spawnSync(require('electron'), [test], {
  cwd: path.join(__dirname, '..'), env, encoding: 'utf8', windowsHide: true, timeout: 90000
});
const output = (result.stdout || '') + (result.stderr || '');
fs.writeFileSync(path.join(__dirname, path.basename(test) + '.log'), output);
console.log(output.split(/\r?\n/).filter(line => /AUDIT|TEST|Error:|FAIL|PASS/.test(line)).join('\n'));
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
