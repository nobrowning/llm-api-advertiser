import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createDiscoveryClient, serviceRecords, SERVICE_TYPE } from '@llm-discovery/discovery-core';
import { createAdvertiser } from '../index.mjs';

const service = { id: 'a-text', instanceName: 'Test Text', hostname: 'test-node.local', address: '192.168.50.10', port: 18443, basePath: '/text/v1' };
const vision = { ...service, id: 'a-vision', instanceName: 'Test Vision', basePath: '/vision/v1' };
const network = () => ({ ethernet: [{ address: '192.168.50.2', mac: 'ab:cd', family: 'IPv4', internal: false }] });
class FakeTransport extends EventEmitter {
  queries = []; responses = []; destroyed = false;
  constructor(config, { ready = true, query } = {}) {
    super(); this.config = config; this.onQuery = query;
    if (ready) queueMicrotask(() => this.emit('ready'));
  }
  query(packet, callback) { this.queries.push(packet); this.onQuery?.(packet, this); if (typeof callback === 'function') callback(); }
  respond(packet, destination, callback) {
    if (typeof destination === 'function') { callback = destination; destination = undefined; }
    this.responses.push({ packet, destination }); callback?.();
  }
  destroy(callback) { this.destroyed = true; callback?.(); }
}
function fakeFactory(options) {
  const sockets = [];
  return { sockets, factory(config) { const socket = new FakeTransport(config, options); sockets.push(socket); return socket; } };
}

test('advertiser validates local IPv4 selection before constructing a transport', async () => {
  for (const interfaceAddress of ['en0', '192.168.50.99', '::1', '127.0.0.1']) {
    const { sockets, factory } = fakeFactory();
    const advertiser = createAdvertiser({ services: [service], interfaceAddress, networkInterfaces: network, transportFactory: factory });
    await assert.rejects(advertiser.start(), /IPv4|not currently attached/);
    assert.equal(sockets.length, 0);
    assert.equal(advertiser.status, 'stopped');
  }
  const { sockets, factory } = fakeFactory();
  const offline = createAdvertiser({ services: [service], networkInterfaces: () => ({}), transportFactory: factory });
  await assert.rejects(offline.start(), /No active IPv4/);
  assert.equal(sockets.length, 0);
});

test('advertiser uses the shared first IPv4 default and checks an address again after stopping', async t => {
  let attached = true;
  const { sockets, factory } = fakeFactory();
  const advertiser = createAdvertiser({ services: [service], networkInterfaces: () => attached ? network() : {}, transportFactory: factory, sleep: async () => {} });
  t.after(() => advertiser.stop());
  await advertiser.start();
  assert.equal(sockets[0].config.interface, '192.168.50.2');
  await advertiser.stop();
  attached = false;
  await assert.rejects(advertiser.start(), /No active IPv4/);
  assert.equal(sockets.length, 1);
});

test('cache-flush protects split address RRsets received within one second', () => {
  let time = 0;
  const client = createDiscoveryClient({ now: () => time });
  client.ingest({ answers: serviceRecords(service) });
  time = 500;
  client.ingest({ answers: [{ name: service.hostname, type: 'A', data: '192.168.50.11', ttl: 120, flush: true }] });
  time = 1600; client.sweep();
  assert.deepEqual(client.snapshot()[0].addresses, ['192.168.50.10', '192.168.50.11']);
  time = 2500;
  client.ingest({ answers: [{ name: service.hostname, type: 'A', data: '192.168.50.12', ttl: 120, flush: true }] });
  time = 3600; client.sweep();
  assert.deepEqual(client.snapshot()[0].addresses, ['192.168.50.12']);
});

test('malformed records and non-mDNS source ports do not crash or create candidates', () => {
  const client = createDiscoveryClient();
  client.ingest({ answers: [{ name: 'x', type: 'SRV', data: null, ttl: 120 }, { name: 'x', type: 'PTR', data: {}, ttl: 120 }, { name: 'x', type: 'TXT', data: [null], ttl: 120 }] });
  client.ingest({ answers: serviceRecords(service) }, { port: 12345 });
  assert.equal(client.snapshot().length, 0);
  client.ingest({ type: 'query', answers: serviceRecords(service) });
  assert.equal(client.snapshot().length, 0);
});

test('split PTR triggers immediate resolution and sockets bind ANY with explicit membership', async (t) => {
  const { sockets, factory } = fakeFactory();
  const client = createDiscoveryClient({ interfaceAddress: '192.168.50.2', transportFactory: factory, networkInterfaces: network });
  t.after(() => client.stop());
  await client.start();
  assert.equal(sockets[0].config.bind, '0.0.0.0');
  assert.equal(sockets[0].config.interface, '192.168.50.2');
  sockets[0].emit('response', { answers: serviceRecords(service).filter((r) => r.type === 'PTR') }, { port: 5353 });
  assert.ok(sockets[0].queries.at(-1).questions.some((q) => q.type === 'SRV'));
  sockets[0].emit('response', { answers: serviceRecords(service).filter((r) => ['SRV', 'TXT'].includes(r.type)) }, { port: 5353 });
  assert.ok(sockets[0].queries.at(-1).questions.some((q) => q.type === 'A'));
});

test('interface change rebuilds multicast membership and ignores queued packets from old attachment', async (t) => {
  let address = '192.168.50.2';
  const { sockets, factory } = fakeFactory();
  const client = createDiscoveryClient({ transportFactory: factory, networkCheckIntervalMs: 5, networkInterfaces: () => ({ lan: [{ family: 'IPv4', address, internal: false }] }) });
  t.after(() => client.stop());
  await client.start();
  sockets[0].emit('response', { answers: serviceRecords(service) });
  const epoch = client.snapshot()[0].attachmentEpoch;
  address = '192.168.60.2';
  for (let i = 0; sockets.length < 2 && i < 20; i++) await delay(5);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(sockets[1].config.interface, address);
  sockets[0].emit('response', { answers: serviceRecords(service) });
  assert.equal(client.snapshot().length, 0);
  sockets[1].emit('response', { answers: serviceRecords(service) });
  assert.ok(client.snapshot()[0].attachmentEpoch > epoch);
});

test('stopping discovery during bind rejects startup and leaves no socket running', async () => {
  const { sockets, factory } = fakeFactory({ ready: false });
  const client = createDiscoveryClient({ transportFactory: factory, networkInterfaces: network });
  const start = client.start();
  const rejected = assert.rejects(start, /cancelled/);
  await client.stop(); await rejected;
  assert.equal(sockets[0].destroyed, true);
  assert.equal(client.running, false);
});

test('advertiser probes three times without cache flush, announces twice, and ignores stale known answers', async (t) => {
  const { sockets, factory } = fakeFactory();
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service], interfaceAddress: '192.168.50.2', transportFactory: factory, sleep: async () => {}, random: () => 0 });
  t.after(() => advertiser.stop());
  await advertiser.start();
  assert.equal(sockets[0].config.bind, '0.0.0.0');
  assert.equal(sockets[0].config.interface, '192.168.50.2');
  assert.equal(sockets[0].queries.length, 3);
  assert.ok(sockets[0].queries.every((q) => q.authorities.every((r) => r.flush === false)));
  assert.equal(sockets[0].responses.length, 2);
  sockets[0].emit('query', { questions: [{ name: SERVICE_TYPE, type: 'PTR' }], answers: serviceRecords({ ...service, port: 9999 }) }, { port: 5353, address: '192.168.50.2' });
  await delay(30);
  assert.equal(advertiser.status, 'announcing');
  assert.equal(sockets[0].destroyed, false);
});

test('legacy unicast answers preserve query ID and never carry cache-flush or long TTL', async (t) => {
  const { sockets, factory } = fakeFactory();
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service], transportFactory: factory, sleep: async () => {} });
  t.after(() => advertiser.stop()); await advertiser.start();
  const rinfo = { port: 60000, address: '192.168.50.2' };
  sockets[0].emit('query', { id: 42, questions: [{ name: SERVICE_TYPE, type: 'PTR' }] }, rinfo);
  const { packet, destination } = sockets[0].responses.at(-1);
  assert.equal(packet.id, 42); assert.deepEqual(destination, rinfo);
  assert.ok([...packet.answers, ...packet.additionals].every((r) => r.flush === false && r.ttl <= 10));
});

test('shared host records survive a single-service goodbye; the last owner withdraws them', async (t) => {
  const { sockets, factory } = fakeFactory();
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service, vision], transportFactory: factory, sleep: async () => {} });
  t.after(() => advertiser.stop()); await advertiser.start();
  await advertiser.setEnabled(service.id, false);
  const first = sockets[0].responses.at(-1).packet.answers;
  assert.ok(first.every((r) => r.ttl === 0));
  assert.ok(!first.some((r) => r.type === 'A'));
  assert.ok(!first.some((r) => String(r.data).includes('Vision')));
  await advertiser.setEnabled(vision.id, false);
  assert.ok(sockets[0].responses.at(-1).packet.answers.some((r) => r.type === 'A' && r.ttl === 0));
});

test('established ownership defends probes, but a genuine response collision aborts initial probing', async (t) => {
  const { sockets, factory } = fakeFactory({ query(packet, socket) {
    if (packet.authorities?.length) socket.emit('response', { answers: serviceRecords({ ...service, port: 18444 }) });
  } });
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service], transportFactory: factory, sleep: async () => {} });
  t.after(() => advertiser.stop());
  await assert.rejects(advertiser.start(), /name conflict/);
  assert.equal(advertiser.status, 'stopped');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(sockets[0].responses.length, 0);
});

test('simultaneous-probe loser defers and retries instead of causing both owners to abort', async (t) => {
  let sent = false;
  const sleeps = [];
  const { sockets, factory } = fakeFactory({ query(packet, socket) {
    if (!sent) { sent = true; socket.emit('query', { questions: packet.questions, authorities: serviceRecords({ ...service, port: 18444 }).filter((r) => r.type !== 'PTR') }); }
  } });
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service], transportFactory: factory, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  t.after(() => advertiser.stop()); await advertiser.start();
  assert.equal(advertiser.status, 'announcing');
  assert.equal(sockets[0].queries.length, 4);
  assert.ok(sleeps.filter((ms) => ms === 1000).length >= 2);
});

test('stop during announcement delay never resurrects an advertiser or sends a second announcement', async () => {
  let release;
  let announceWaiting;
  const waiting = new Promise((resolve) => { announceWaiting = resolve; });
  const { sockets, factory } = fakeFactory();
  const advertiser = createAdvertiser({ networkInterfaces: network, services: [service], transportFactory: factory, sleep: (ms) => ms === 1000 ? new Promise((resolve) => { release = resolve; announceWaiting(); }) : Promise.resolve() });
  const start = advertiser.start();
  const rejected = assert.rejects(start, /cancelled/);
  await waiting;
  await advertiser.stop(); release(); await rejected;
  assert.equal(advertiser.status, 'stopped');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(sockets[0].responses.filter(({ packet }) => packet.answers.some((r) => r.ttl > 0)).length, 1);
});
