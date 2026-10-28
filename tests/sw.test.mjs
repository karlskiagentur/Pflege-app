// Service Worker (public/sw.js): Push anzeigen, offene App informieren, Tipp öffnet die
// passende Ansicht. Läuft in einer nachgebauten Worker-Umgebung (node:vm), ohne Browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function worker({ fenster = [] } = {}) {
  const handler = {};
  const log = { benachrichtigungen: [], geoeffnet: [], nachrichten: [], fokussiert: 0, badge: [] };
  const offen = fenster.map(() => ({
    focus() { log.fokussiert += 1; return Promise.resolve(this); },
    postMessage(m) { log.nachrichten.push(m); },
  }));
  const self = {
    addEventListener: (typ, fn) => { handler[typ] = fn; },
    registration: { showNotification: async (titel, optionen) => { log.benachrichtigungen.push({ titel, ...optionen }); } },
    navigator: { setAppBadge: async (n) => { log.badge.push(n); } },
    skipWaiting: () => Promise.resolve(),
    clients: null,
  };
  const clients = {
    matchAll: async () => offen,
    openWindow: async (url) => { log.geoeffnet.push(url); },
    claim: () => Promise.resolve(),
  };
  self.clients = clients;
  vm.runInNewContext(code, { self, clients, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [] }, URL, fetch: async () => ({}) });
  const ausloesen = async (typ, ereignis) => {
    let warten = Promise.resolve();
    handler[typ]({ ...ereignis, waitUntil: (p) => { warten = p; } });
    await warten;
  };
  return { log, ausloesen };
}
const pushEreignis = (daten) => ({ data: { json: () => daten } });
const klick = (daten) => ({ notification: { data: daten, close() {} } });

test('Push: Benachrichtigung mit Ziel; offene App wird sofort informiert', async () => {
  const { log, ausloesen } = worker({ fenster: [1] });
  await ausloesen('push', pushEreignis({ title: 'Einsatz abgesagt', body: 'Grundpflege …', ziel: 'plan' }));
  assert.equal(log.benachrichtigungen[0].titel, 'Einsatz abgesagt');
  assert.equal(log.benachrichtigungen[0].body, 'Grundpflege …');
  assert.deepEqual({ ...log.benachrichtigungen[0].data }, { ziel: 'plan' });
  assert.deepEqual(log.nachrichten.map((m) => ({ ...m })), [{ typ: 'push-eingang', ziel: 'plan' }]);
});

test('Push ohne/mit unbekanntem Ziel: Standardtext, kein Ziel', async () => {
  const { log, ausloesen } = worker();
  await ausloesen('push', pushEreignis({ ziel: 'javascript:alert(1)' }));
  assert.equal(log.benachrichtigungen[0].titel, 'Wunschlos Pflege');
  assert.equal(log.benachrichtigungen[0].body, 'Neue Information');
  assert.equal(log.benachrichtigungen[0].data.ziel, '');
  await ausloesen('push', { data: { json: () => { throw new Error('kein JSON'); } } });
  assert.equal(log.benachrichtigungen.length, 2);
});

test('Tipp: App geschlossen -> öffnet die passende Ansicht; unbekanntes Ziel -> Startseite', async () => {
  let w = worker();
  await w.ausloesen('notificationclick', klick({ ziel: 'lohn' }));
  assert.deepEqual(w.log.geoeffnet, ['/?ziel=lohn']);
  w = worker();
  await w.ausloesen('notificationclick', klick({ ziel: '../böse' }));
  assert.deepEqual(w.log.geoeffnet, ['/']);
  w = worker();
  await w.ausloesen('notificationclick', klick(undefined));
  assert.deepEqual(w.log.geoeffnet, ['/']);
});

test('Tipp: App schon offen -> nach vorne holen und Ziel mitteilen (kein zweites Fenster)', async () => {
  const { log, ausloesen } = worker({ fenster: [1] });
  await ausloesen('notificationclick', klick({ ziel: 'nachrichten' }));
  assert.equal(log.fokussiert, 1);
  assert.deepEqual(log.geoeffnet, []);
  assert.deepEqual(log.nachrichten.map((m) => ({ ...m })), [{ typ: 'push-klick', ziel: 'nachrichten' }]);
});
