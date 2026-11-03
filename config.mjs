import { isIP } from 'node:net';
import { serviceRecords, canonicalName } from '@llm-discovery/discovery-core';

function object(value, name, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`Unknown ${name} field: ${key}.`);
}

function text(value, name, limit) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value) || Buffer.byteLength(value) > limit) throw new Error(`${name} must be nonempty text of at most ${limit} UTF-8 bytes without control characters.`);
}

/** Validate JSON configuration without opening a socket or changing the input. */
export function validateAdvertiserConfig(input) {
  object(input, 'configuration', ['interfaceAddress', 'ttl', 'services']);
  if (input.interfaceAddress !== undefined && isIP(input.interfaceAddress) !== 4) throw new Error('interfaceAddress must be a local IPv4 interface address.');
  const ttl = input.ttl ?? 120;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 4500) throw new Error('ttl must be an integer from 1 to 4500 seconds.');
  if (!Array.isArray(input.services) || !input.services.length || input.services.length > 128) throw new Error('services must contain between 1 and 128 endpoints.');
  const ids = new Set(), instances = new Set(), hosts = new Map();
  const services = input.services.map((value, index) => {
    const name = `services[${index}]`;
    object(value, name, ['id', 'instanceName', 'hostname', 'address', 'port', 'basePath', 'enabled', 'auth']);
    text(value.id, `${name}.id`, 128);
    text(value.instanceName, `${name}.instanceName`, 63);
    // dns-packet cannot escape a literal dot within a label. Accept one label,
    // rather than silently publishing a different DNS-SD instance structure.
    if (value.instanceName.includes('.')) throw new Error(`${name}.instanceName must be a single DNS label without dots.`);
    text(value.hostname, `${name}.hostname`, 253);
    const hostname = canonicalName(value.hostname);
    if (!hostname.endsWith('.local') || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error(`${name}.hostname must be a valid .local hostname.`);
    if (isIP(value.address) !== 4 || /^(0\.|127\.|22[4-9]\.|23\d\.)/.test(value.address) || value.address === '255.255.255.255') throw new Error(`${name}.address must be an explicit, non-loopback unicast IPv4 address reachable by clients.`);
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error(`${name}.enabled must be boolean.`);
    const instance = value.instanceName.toLowerCase();
    if (ids.has(value.id) || instances.has(instance)) throw new Error('Service IDs and case-insensitive instance names must be unique.');
    if (hosts.has(hostname) && hosts.get(hostname) !== value.address) throw new Error('Services sharing a hostname must use the same address.');
    ids.add(value.id); instances.add(instance); hosts.set(hostname, value.address);
    const service = { ...value, hostname, basePath: value.basePath ?? '/v1', enabled: value.enabled ?? true, auth: value.auth === undefined ? 'required' : value.auth };
    serviceRecords(service, ttl);
    return service;
  });
  return { ...(input.interfaceAddress === undefined ? {} : { interfaceAddress: input.interfaceAddress }), ttl, services };
}
