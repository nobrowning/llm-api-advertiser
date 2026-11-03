import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { validateAdvertiserConfig } from '../config.mjs';
import { serviceRecords, parseTxt } from '@llm-discovery/discovery-core';

const example = JSON.parse(await readFile(new URL('../examples/advertiser.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const runCli = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });

test('standalone configuration supports two routes on one host without mutating input', () => {
  const original = structuredClone(example);
  const result = validateAdvertiserConfig(example);
  assert.equal(result.services.length, 2);
  assert.equal(result.services[0].hostname, result.services[1].hostname);
  assert.notEqual(result.services[0].basePath, result.services[1].basePath);
  assert.deepEqual(result.services.map(service => service.auth), ['required', 'none']);
  assert.deepEqual(result.services.map(service => parseTxt(serviceRecords(service).find(record => record.type === 'TXT').data).fields.auth), ['required', 'none']);
  assert.deepEqual(example, original);
  result.services[0].port = 1;
  assert.equal(example.services[0].port, 8443);
});

test('CLI lists interfaces and emits a portable example without requiring a config or opening sockets', () => {
  const listed = runCli(['--list-interfaces', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  const { interfaces } = JSON.parse(listed.stdout);
  assert.ok(Array.isArray(interfaces));
  assert.ok(interfaces.every(row => typeof row.name === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(row.address)));
  const generated = runCli(['--example']);
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(validateAdvertiserConfig(JSON.parse(generated.stdout)), validateAdvertiserConfig(example));
  const help = runCli(['--help']);
  assert.match(help.stdout, /--list-interfaces/);
  assert.match(help.stdout, /--example/);
  assert.match(help.stdout, /not a device name/);
});

test('CLI rejects ambiguous action modes and duplicate options before opening a socket', () => {
  for (const args of [
    ['--json'], ['--example', '--check'], ['--list-interfaces', '--config', 'unused.json'],
    ['--example', '--list-interfaces'], ['--check', '--check'], ['--list-interfaces', '--list-interfaces'],
    ['--config', 'one.json', '--config', 'two.json'], ['--unknown'],
  ]) assert.equal(runCli(args).status, 1, args.join(' '));
});

test('CLI creates UTF-8 examples in paths with spaces, refuses overwrite, and accepts UTF-8 BOM configs', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'advertiser-cli-test-'));
  t.after(async () => {
    const base = await realpath(tmpdir()), target = await realpath(scratch), rel = relative(base, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && dirname(target) === base);
    await rm(target, { recursive: true, force: true });
  });
  const file = join(scratch, 'my services 服务.json');
  const created = runCli(['--example', file]);
  assert.equal(created.status, 0, created.stderr);
  const initial = await readFile(file);
  assert.deepEqual(JSON.parse(initial.toString('utf8')), example);
  assert.equal(runCli(['--example', file]).status, 1);
  assert.deepEqual(await readFile(file), initial);
  assert.equal(runCli(['--config', file, '--check']).status, 0);
  await writeFile(file, `\uFEFF${initial.toString('utf8')}`, 'utf8');
  const checked = runCli(['--config', file, '--check']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).valid, true);
});

test('configuration rejects accidental secrets, invalid records and ambiguous ownership', () => {
  for (const patch of [
    { token: 'not-a-real-token' }, { ttl: 0 }, { interfaceAddress: 'not-an-ip' },
    { services: [] },
    { services: [{ ...example.services[0], instanceName: 'Qwen2.5' }] },
    { services: [{ ...example.services[0], hostname: 'invalid.example' }] },
    { services: [{ ...example.services[0], address: '127.0.0.1' }] },
    { services: [{ ...example.services[0], basePath: '/v1/../admin' }] },
    { services: [{ ...example.services[0], authToken: 'not-a-real-token' }] },
    ...['optional', 'bearer', 'NONE', '', null, 0, false].map(auth => ({ services: [{ ...example.services[0], auth }] })),
    { services: [example.services[0], { ...example.services[1], id: example.services[0].id }] },
    { services: [example.services[0], { ...example.services[1], instanceName: example.services[0].instanceName.toUpperCase() }] },
    { services: [example.services[0], { ...example.services[1], address: '192.168.1.21' }] },
  ]) assert.throws(() => validateAdvertiserConfig({ ...example, ...patch }));
});

test('omitting authentication retains required as the safe compatibility default', () => {
  const input = structuredClone(example);
  for (const service of input.services) delete service.auth;
  const result = validateAdvertiserConfig(input);
  assert.deepEqual(result.services.map(service => service.auth), ['required', 'required']);
  assert.ok(input.services.every(service => !Object.hasOwn(service, 'auth')));
});

test('CLI provides help and validates a portable example without advertising', () => {
  const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  const config = fileURLToPath(new URL('../examples/advertiser.json', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: llm-api-advertise/);
  const check = spawnSync(process.execPath, [cli, '--config', config, '--check'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout), { valid: true, services: 2, ttl: 120 });
  const invalid = spawnSync(process.execPath, [cli, '--config', config, '--interface', 'bad', '--check'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /interfaceAddress/);
});
