#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { listIPv4Interfaces } from '@llm-discovery/discovery-core';
import { createAdvertiser } from './index.mjs';
import { validateAdvertiserConfig } from './config.mjs';

const help = `Usage: llm-api-advertise --config FILE [--interface IPv4] [--check]
       llm-api-advertise --list-interfaces [--json]
       llm-api-advertise --example [FILE]

Announce existing HTTPS Open Responses APIs using _llm-api._tcp.local.
  --config FILE      UTF-8 JSON configuration; generate one with --example FILE
  --interface IPv4   Local IPv4 address, not a device name such as en0 or eth0
  --check            Validate configuration syntax without network activity
  --list-interfaces  List assigned non-loopback IPv4 addresses without sockets
  --json             Machine-readable output for --list-interfaces
  --example [FILE]   Print example JSON or create FILE as UTF-8; never overwrite
  --help             Show this help

Requires Node.js 22+ on Windows, macOS, or Linux. Select the service LAN address;
without --interface/config.interfaceAddress the first eligible IPv4 is selected.
Runtime startup checks that the selected address is attached. --check does not.
This command only announces endpoints. It does not run an API, issue credentials,
change firewall rules, or inspect endpoint readiness. Stop with Ctrl+C or SIGTERM
for goodbye records. IPv6 and cross-subnet discovery are not supported.
`;

async function run() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') { process.stdout.write(help); return; }
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${key}.`);
    if (['--check', '--list-interfaces', '--json'].includes(key)) { options[key] = true; continue; }
    if (key === '--example') {
      options[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      continue;
    }
    if (!['--config', '--interface'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${key}. Use --help.`);
    options[key] = args[++i];
  }
  if (options['--json'] && !options['--list-interfaces']) throw new Error('--json requires --list-interfaces.');
  if (options['--list-interfaces']) {
    if (Object.keys(options).some(key => !['--list-interfaces', '--json'].includes(key))) throw new Error('--list-interfaces cannot be combined with configuration or example options.');
    const interfaces = listIPv4Interfaces().map(({ name, address }) => ({ name, address }));
    if (options['--json']) process.stdout.write(`${JSON.stringify({ interfaces })}\n`);
    else process.stdout.write(interfaces.length ? `Interface\tIPv4 address\n${interfaces.map(row => `${row.name}\t${row.address}`).join('\n')}\n` : 'No active non-loopback IPv4 interface found.\n');
    return;
  }
  if (options['--example']) {
    if (Object.keys(options).length !== 1) throw new Error('--example cannot be combined with configuration options.');
    const example = await readFile(new URL('./examples/advertiser.json', import.meta.url), 'utf8');
    if (options['--example'] === true) process.stdout.write(example);
    else {
      await writeFile(options['--example'], example, { encoding: 'utf8', flag: 'wx' });
      process.stdout.write(`Created ${options['--example']}. Replace its illustrative IP and API settings before starting.\n`);
    }
    return;
  }
  if (!options['--config']) throw new Error('--config FILE is required. Use --help.');
  const file = options['--config'];
  const info = await stat(file);
  if (!info.isFile() || info.size > 65536) throw new Error('Configuration must be a JSON file no larger than 64 KiB.');
  const input = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (options['--interface']) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object.');
    input.interfaceAddress = options['--interface'];
  }
  const config = validateAdvertiserConfig(input);
  if (options['--check']) { process.stdout.write(`${JSON.stringify({ valid: true, services: config.services.length, ttl: config.ttl })}\n`); return; }
  const logger = event => {
    if (event.type === 'conflict') process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
  };
  const advertiser = createAdvertiser({ ...config, logger });
  let shutdown;
  const detach = () => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); };
  const stop = () => shutdown ??= advertiser.stop().finally(detach);
  const onSignal = () => { void stop().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try { await advertiser.start(); }
  catch (error) { const interrupted = !!shutdown; await stop(); if (!interrupted) throw error; }
}

run().catch(error => { process.stderr.write(`llm-api-advertise: ${error.message}\n`); process.exitCode = 1; });
