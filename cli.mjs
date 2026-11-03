#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createAdvertiser } from './index.mjs';
import { validateAdvertiserConfig } from './config.mjs';

const help = `Usage: llm-api-advertise --config FILE [--interface IPv4] [--check]

Announce existing HTTPS Open Responses APIs using _llm-api._tcp.local.
  --config FILE     JSON configuration; see examples/advertiser.json
  --interface IPv4  Override the outgoing local IPv4 interface
  --check           Validate configuration and exit without network activity
  --help            Show this help

This command only announces endpoints. It does not run an API, issue credentials,
change firewall rules, or inspect endpoint readiness. Stop with Ctrl+C for goodbye
records. Keep the advertised service reachable while this process runs.
`;

async function run() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') { process.stdout.write(help); return; }
    if (key === '--check') { options.check = true; continue; }
    if (!['--config', '--interface'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${key}. Use --help.`);
    if (options[key] !== undefined) throw new Error(`Duplicate option: ${key}.`);
    options[key] = args[++i];
  }
  if (!options['--config']) throw new Error('--config FILE is required. Use --help.');
  const file = options['--config'];
  const info = await stat(file);
  if (!info.isFile() || info.size > 65536) throw new Error('Configuration must be a JSON file no larger than 64 KiB.');
  const input = JSON.parse(await readFile(file, 'utf8'));
  if (options['--interface']) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object.');
    input.interfaceAddress = options['--interface'];
  }
  const config = validateAdvertiserConfig(input);
  if (options.check) { process.stdout.write(`${JSON.stringify({ valid: true, services: config.services.length, ttl: config.ttl })}\n`); return; }
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
