import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('These Foundation helper tests require macOS and the Xcode Swift toolchain.');
}
const moduleRoot = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'rn-read-native-tests-'));
try {
  const executable = join(temporary, 'native-helpers');
  execFileSync('swiftc', [
    join(moduleRoot, 'ios/AccessPath.swift'),
    join(moduleRoot, 'ios/AccessIdentity.swift'),
    join(moduleRoot, 'ios/AccessBookmark.swift'),
    join(moduleRoot, 'tests/main.swift'),
    '-o', executable,
  ], { stdio: 'inherit' });
  execFileSync(executable, [], { stdio: 'inherit' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
