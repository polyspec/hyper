// Runs the TypeScript compiler that this checkout installed, by the path of its package, with the arguments of the
// call (HY-79): npm installs no bin links, so `npx tsc` and `npm exec tsc` find no command. The packages declare their
// build with it (`npm run build` in packages/hyper-client and packages/hyper-node), and the Makefile runs it as TSC.
//
// Usage: node scripts/tsc.mjs <tsc arguments>...
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const manifest = require.resolve('typescript/package.json');
const compiler = join(dirname(manifest), require(manifest).bin.tsc);
const result = spawnSync(process.execPath, [compiler, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
