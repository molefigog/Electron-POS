// Windows only: lets the other PCs on the PRIVATE network reach the main PC's port.
// The app already runs as administrator, so it can add the rule itself.
import { execFile } from 'node:child_process';

const RULE_NAME = 'Electron POS (LAN)';

function netsh(args) {
  return new Promise((resolve) => {
    execFile('netsh', args, { windowsHide: true }, (err) => resolve(!err));
  });
}

export async function ensureFirewallRule(port) {
  if (process.platform !== 'win32') return false;
  await netsh(['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`]);
  return netsh([
    'advfirewall', 'firewall', 'add', 'rule',
    `name=${RULE_NAME}`, 'dir=in', 'action=allow', 'protocol=TCP',
    `localport=${port}`, 'profile=private,domain',
  ]);
}
