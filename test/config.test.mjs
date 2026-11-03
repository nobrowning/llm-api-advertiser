import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAdvertiserConfig } from '../config.mjs';
import { serviceRecords, parseTxt } from '@llm-discovery/discovery-core';

const example = JSON.parse(await readFile(new URL('../examples/advertiser.json', import.meta.url), 'utf8'));

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
