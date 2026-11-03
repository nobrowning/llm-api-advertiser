import multicastDns from 'multicast-dns';
import dnsPacket from 'dns-packet';
import { canonicalName, SERVICE_TYPE, serviceRecords, normalizeRecord, recordIdentity } from '@llm-discovery/discovery-core';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => recordIdentity(a) !== null && recordIdentity(a) === recordIdentity(b);
const recordTypes = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };

// RFC 6762 §8.2: compare class, numeric type, then raw uncompressed RDATA.
function tieBytes(record) {
  const value = normalizeRecord(record);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt16BE(1, 0); prefix.writeUInt16BE(recordTypes[value.type], 2);
  return Buffer.concat([prefix, dnsPacket.record(value.type).encode(value.data).subarray(2)]);
}
function compareSets(ours, theirs) {
  const a = ours.map(tieBytes).sort(Buffer.compare), b = theirs.map(tieBytes).sort(Buffer.compare);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const comparison = Buffer.compare(a[i], b[i]);
    if (comparison) return comparison;
  }
  return a.length - b.length;
}

export function createAdvertiser({ services, interfaceAddress, ttl = 120, logger = () => {}, port = 5353,
  transportFactory = (config) => multicastDns(config), sleep = defaultSleep, random = Math.random, now = Date.now }) {
  if (!Array.isArray(services) || !services.length || new Set(services.map((s) => s.id)).size !== services.length) throw new Error('Unique service IDs are required');
  for (const service of services) serviceRecords(service, ttl);
  let mdns;
  let status = 'stopped';
  let epoch = 0;
  let starting;
  let stopping;
  let cancelBind;
  let probeStarted = false;
  let probeConflict;
  let loseTie = false;
  let lastDefense = -Infinity;
  let operation = Promise.resolve();
  const pendingResponses = new Set();
  const enabled = new Map(services.map((s) => [s.id, s.enabled !== false]));
  const log = (entry) => { try { logger(entry); } catch {} };
  const allRecords = (recordTtl = ttl) => {
    const records = services.filter((s) => enabled.get(s.id)).flatMap((s) => serviceRecords(s, recordTtl));
    return [...new Map(records.map((r) => [recordIdentity(r), r])).values()];
  };
  const checkEpoch = (expected) => { if (!mdns || epoch !== expected || status === 'stopped') throw new Error('mDNS advertiser operation cancelled'); };
  const publish = (records = allRecords(), socket = mdns) => new Promise((resolve, reject) => {
    if (!socket || !records.length) return resolve();
    try { socket.respond({ answers: records }, (error) => error ? reject(error) : resolve()); }
    catch (error) { reject(error); }
  });
  const report = (promise) => { void promise.catch((error) => log({ type: 'error', message: error.message })); };
  function responseConflict(packet) {
    if (status === 'stopped' || (status === 'probing' && !probeStarted)) return;
    const own = allRecords().filter((r) => r.type !== 'PTR');
    for (const incoming of [...(packet.answers ?? []), ...(packet.additionals ?? [])].map(normalizeRecord).filter(Boolean)) {
      if (incoming.ttl === 0) continue;
      const ours = own.filter((r) => canonicalName(r.name) === canonicalName(incoming.name) && r.type === incoming.type);
      if (!ours.length || ours.some((r) => same(r, incoming))) continue;
      const message = `mDNS name conflict: ${incoming.name}`;
      if (status === 'probing') { probeConflict = message; return; }
      // Defend once. Repeated conflicts fail closed without erasing the other owner's records.
      if (now() - lastDefense < 10000) { log({ type: 'conflict', message }); report(stop({ goodbye: false })); }
      else { lastDefense = now(); log({ type: 'defending', message }); report(publish()); }
      return;
    }
  }
  function probeQuery(packet) {
    if (status !== 'probing' || !probeStarted) return;
    const proposed = (packet.authorities ?? []).map(normalizeRecord).filter((r) => r && r.type !== 'PTR' && r.ttl > 0);
    const own = allRecords().filter((r) => r.type !== 'PTR');
    for (const name of new Set(proposed.map((r) => canonicalName(r.name)))) {
      if (!(packet.questions ?? []).some((q) => canonicalName(q.name) === name)) continue;
      const ours = own.filter((r) => canonicalName(r.name) === name);
      const theirs = proposed.filter((r) => canonicalName(r.name) === name);
      if (ours.length && compareSets(ours, theirs) < 0) loseTie = true;
    }
  }
  function onQuery(packet, rinfo = {}) {
    // Query answers are a querier's cache, never authoritative ownership claims.
    probeQuery(packet);
    if (status !== 'announcing') return;
    const records = allRecords();
    const questions = packet.questions ?? [];
    const direct = records.filter((r) => questions.some((q) => canonicalName(q.name) === canonicalName(r.name) && (q.type === 'ANY' || q.type === r.type)));
    const known = (packet.answers ?? []).map(normalizeRecord).filter(Boolean);
    const answers = direct.filter((record) => !known.some((r) => same(r, record) && r.ttl >= ttl / 2));
    if (!answers.length) return;
    const related = new Set(answers.map((r) => canonicalName(r.name)));
    for (const r of answers) if (r.type === 'PTR') related.add(canonicalName(r.data));
    for (const r of records) if (related.has(canonicalName(r.name)) && r.type === 'SRV') related.add(canonicalName(r.data.target));
    const additionals = records.filter((r) => related.has(canonicalName(r.name)) && !direct.some((answer) => same(answer, r)) && r.type !== 'PTR');
    const socket = mdns, queryEpoch = epoch;
    const legacy = rinfo.port !== undefined && rinfo.port !== port;
    // dns-packet 5.6 decodes the QU class as UNKNOWN_32769.
    const unicast = legacy || questions.some((q) => q.qu === true || q.class === 'UNKNOWN_32769');
    const send = () => {
      if (!socket || socket !== mdns || queryEpoch !== epoch || status !== 'announcing') return;
      const body = legacy
        ? { id: packet.id, questions, answers: answers.map((r) => ({ ...r, ttl: Math.min(r.ttl, 10), flush: false })), additionals: additionals.map((r) => ({ ...r, ttl: Math.min(r.ttl, 10), flush: false })) }
        : { answers, additionals };
      try { socket.respond(body, unicast ? rinfo : undefined, (error) => { if (error) log({ type: 'error', message: error.message }); }); }
      catch (error) { log({ type: 'error', message: error.message }); }
    };
    if (unicast || packet.authorities?.length) send();
    else {
      const timer = setTimeout(() => { pendingResponses.delete(timer); send(); }, 20 + Math.floor(random() * 100));
      pendingResponses.add(timer);
    }
  }
  async function probe(expected) {
    probeConflict = null;
    probeStarted = false;
    await sleep(Math.floor(random() * 250));
    checkEpoch(expected);
    for (let attempt = 0; attempt < 4; attempt++) {
      loseTie = false;
      const unique = allRecords().filter((r) => r.type !== 'PTR').map((r) => ({ ...r, flush: false }));
      if (!unique.length) return;
      const questions = [...new Map(unique.map((r) => [canonicalName(r.name), { name: r.name, type: 'ANY' }])).values()];
      for (let i = 0; i < 3; i++) {
        checkEpoch(expected); probeStarted = true;
        mdns.query({ questions, authorities: unique });
        await sleep(250);
        checkEpoch(expected);
        if (probeConflict) throw new Error(probeConflict);
        if (loseTie) break;
      }
      if (!loseTie) return;
      log({ type: 'probe-deferred', message: 'Lost simultaneous-probe tiebreak; retrying after one second.' });
      probeStarted = false;
      await sleep(1000); checkEpoch(expected);
    }
    throw new Error('mDNS name remains contested after probe retries');
  }
  async function announce(expected) {
    checkEpoch(expected); status = 'announcing';
    await publish(); await sleep(1000); checkEpoch(expected); await publish();
    // Refreshes are query driven; no periodic unsolicited announcements.
    log({ type: 'announced', services: services.filter((s) => enabled.get(s.id)).map((s) => s.id), serviceType: SERVICE_TYPE });
  }
  async function start() {
    if (starting) return starting;
    if (mdns) return;
    if (stopping) await stopping;
    const expected = ++epoch;
    status = 'probing'; lastDefense = -Infinity;
    const socket = mdns = transportFactory({ bind: '0.0.0.0', interface: interfaceAddress, port, loopback: true, reuseAddr: true });
    socket.on('query', (packet, rinfo) => { if (mdns === socket) onQuery(packet, rinfo); });
    socket.on('response', (packet) => { if (mdns === socket) responseConflict(packet); });
    socket.on('warning', (error) => log({ type: 'warning', message: error.message }));
    socket.on('error', (error) => log({ type: 'error', message: error.message }));
    starting = (async () => {
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); socket.removeListener('ready', ready); socket.removeListener('error', failed); if (cancelBind === cancel) cancelBind = undefined; };
        const ready = () => { cleanup(); resolve(); };
        const failed = (error) => { cleanup(); reject(error); };
        const cancel = () => failed(new Error('mDNS advertiser startup cancelled'));
        const timer = setTimeout(() => failed(new Error('mDNS advertiser bind timed out')), 5000);
        cancelBind = cancel; socket.once('ready', ready); socket.once('error', failed);
      });
      await probe(expected);
      await announce(expected);
    })().catch(async (error) => {
      if (mdns === socket) { status = 'stopped'; mdns = null; await new Promise((resolve) => socket.destroy(resolve)); }
      throw error;
    }).finally(() => { starting = null; });
    return starting;
  }
  function setEnabled(serviceId, value) {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return Promise.reject(new Error('Unknown service ID'));
    if (typeof value !== 'boolean') return Promise.reject(new Error('enabled must be boolean'));
    const task = operation.then(async () => {
      if (starting) await starting;
      if (enabled.get(serviceId) === value) return;
      const before = allRecords();
      enabled.set(serviceId, value);
      if (!mdns || status !== 'announcing') return;
      const expected = epoch;
      if (value) {
        status = 'probing';
        try { await probe(expected); await announce(expected); }
        catch (error) { enabled.set(serviceId, false); if (mdns && epoch === expected) status = 'announcing'; throw error; }
      } else {
        const retained = new Set(allRecords().map(recordIdentity));
        await publish(before.filter((r) => !retained.has(recordIdentity(r))).map((r) => ({ ...r, ttl: 0 })));
      }
      log({ type: value ? 'service-added' : 'service-withdrawn', serviceId });
    });
    operation = task.catch(() => {});
    return task;
  }
  async function stop({ goodbye = true } = {}) {
    if (stopping) return stopping;
    ++epoch; cancelBind?.();
    for (const timer of pendingResponses) clearTimeout(timer);
    pendingResponses.clear();
    const socket = mdns;
    const wasAnnouncing = status === 'announcing';
    status = 'stopped'; mdns = null;
    if (!socket) return;
    stopping = (async () => {
      if (wasAnnouncing && goodbye) await publish(allRecords(0), socket).catch(() => {});
      await new Promise((resolve) => socket.destroy(resolve));
    })().finally(() => { stopping = null; });
    return stopping;
  }
  return { start, stop, setEnabled, get status() { return status; } };
}
