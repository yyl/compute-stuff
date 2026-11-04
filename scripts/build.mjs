import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync('hugo', ['--gc', '--minify', '--destination', 'build', '--cacheDir', resolve('.cache/hugo')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
