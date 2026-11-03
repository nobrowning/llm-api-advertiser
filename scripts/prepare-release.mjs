import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, process.argv[2] ?? '.release-artifacts');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.ok(process.env.npm_execpath, 'Run with npm run release:prepare.');
const npm = (args, cwd = root, env = {}) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
});
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
await mkdir(out, { recursive: true });
const pack = () => JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', out]))[0];
const packed = pack();
assert.equal(packed.name, manifest.name);
assert.equal(packed.version, manifest.version);
const ownedFiles = ['LICENSE', 'README.md', 'README.zh-CN.md', 'THIRD_PARTY_NOTICES.md', 'cli.mjs', 'config.mjs',
  'examples/advertiser.json', 'index.mjs', 'licenses/dns-packet.LICENSE', 'licenses/ip-codec.LICENSE',
  'licenses/multicast-dns.LICENSE', 'licenses/thunky.LICENSE', 'package.json', 'vendor/README.md'];
assert.deepEqual(packed.files.filter(file => !file.path.startsWith('node_modules/')).map(file => file.path).sort(), ownedFiles.sort());
const dependencies = ['@leichtgewicht/ip-codec', '@llm-discovery/discovery-core', 'dns-packet', 'multicast-dns', 'thunky'];
assert.deepEqual(packed.bundled.sort(), dependencies.sort());
for (const file of packed.files) {
  assert.ok(!/(^|\/)(\.git|\.runtime|\.reference|\.env(?:\..*)?|\.npmrc)(\/|$)|\.(pem|key|pfx|p12)$/i.test(file.path), `Unexpected private file: ${file.path}`);
  if (file.path.startsWith('node_modules/')) {
    assert.ok(dependencies.some(name => file.path.startsWith(`node_modules/${name}/`)), `Unexpected dependency file: ${file.path}`);
  }
}
const archive = join(out, packed.filename);
const checksum = await sha256(archive);
assert.equal(pack().filename, packed.filename);
assert.equal(await sha256(archive), checksum, 'Repeated npm pack must produce identical bytes.');

const scratch = await mkdtemp(join(tmpdir(), 'llm-advertiser-release-'));
try {
  const cleanCache = { npm_config_cache: join(scratch, 'npm-cache') };
  await writeFile(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive], scratch, cleanCache);
  await writeFile(join(scratch, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createAdvertiser } from '@llm-discovery/advertiser';
import { validateAdvertiserConfig } from '@llm-discovery/advertiser/config';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('./node_modules/@llm-discovery/advertiser/examples/advertiser.json', import.meta.url), 'utf8'));
const advertiser = createAdvertiser(validateAdvertiserConfig(config));
assert.equal(advertiser.status, 'stopped');
console.log('Installed archive exports and example configuration passed.');
`);
  process.stdout.write(execFileSync(process.execPath, ['smoke.mjs'], { cwd: scratch, encoding: 'utf8', timeout: 15_000 }));
  const example = join(scratch, 'node_modules', '@llm-discovery', 'advertiser', 'examples', 'advertiser.json');
  const check = npm(['exec', '--offline', '--no', '--', 'llm-api-advertise', '--config', example, '--check'], scratch, cleanCache);
  assert.equal(JSON.parse(check).valid, true);
  assert.match(npm(['exec', '--offline', '--no', '--', 'llm-api-advertise', '--help'], scratch, cleanCache), /Usage: llm-api-advertise/);
  process.stdout.write('Installed CLI --help and --check passed with an empty offline npm cache.\n');
} finally {
  const tempRoot = await realpath(tmpdir());
  const target = await realpath(scratch);
  const rel = relative(tempRoot, target);
  assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && dirname(target) === tempRoot,
    'Temporary cleanup must stay directly under the resolved temporary directory.');
  await rm(target, { recursive: true, force: true });
}
await writeFile(join(out, 'SHA256SUMS'), `${checksum}  ${packed.filename}\n`);
process.stdout.write(`${packed.filename}\nSHA256 ${checksum}\n`);
