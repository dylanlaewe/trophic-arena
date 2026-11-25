import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BOT_NAME, botForecast } from './bot.mjs';
import { verify } from './cli.mjs';
import { simulate } from './engine.mjs';
import { createArena } from './server.mjs';

test('a sealed multiplayer round survives restart and can be independently replayed', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'trophic-round-'));
  let server;
  let base;
  async function start() {
    server = createArena({ dataDir });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function api(path, body, token) {
    const options = body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: JSON.stringify(body)
    };
    const response = await fetch(base + path, options);
    return { status: response.status, data: await response.json() };
  }

  await start();
  const created = await api('/api/rooms', {});
  assert.equal(created.status, 201);
  const { code, hostToken, commitment } = created.data;
  assert.match(commitment, /^[0-9a-f]{64}$/);
  const path = '/api/rooms/' + code;
  const opened = (await api(path)).data;
  assert.equal(opened.phase, 'open');
  assert.equal(opened.commitment, commitment);
  assert.deepEqual(Object.keys(opened).sort(), [
    'code','phase','entries','commitment','engineVersion','width','height','biome','terrain',
    'questions','observationTick','endTick','frames','events'
  ].sort());
  assert.equal(opened.frames.at(-1).tick, opened.observationTick);
  assert.ok(opened.events.every(event => event.tick <= opened.observationTick));
  assert.deepEqual((await api(path + '/status')).data, { phase: 'open', entries: 0 });
  assert.equal((await api(path + '/refuge')).status, 409);
  assert.equal((await api(path + '/settle', {}, hostToken)).status, 409);
  assert.equal((await api('/.arena-data/rooms.sqlite')).status, 404);
  assert.equal((await api('/server.mjs')).status, 404);
  assert.equal((await api('/data/reference-worlds.json')).status, 404);

  const probabilities = Object.fromEntries(opened.questions.map(({id}) => [id, 0.5]));
  const first = { name: 'Rhea', probabilities };
  const second = { name: 'Ibis', probabilities: { ...probabilities, [opened.questions[0].id]: 1 } };
  for (const invalid of [
    { ...first, name: 'field agent' }, { ...first, name: '  ' }, { ...first, name: 'a'.repeat(25) },
    { ...first, probabilities: {} }, { ...first, probabilities: { ...probabilities, extra: 0 } },
    { ...first, probabilities: { ...probabilities, [opened.questions[0].id]: '0.1' } }
  ]) assert.equal((await api(path + '/forecasts', invalid)).status, 400);

  assert.equal((await api(path + '/forecasts', { content: 'x'.repeat(5000) })).status, 413);
  const replies = await Promise.all([first, second, first].map(body => api(path + '/forecasts', body)));
  assert.ok(replies.every(reply => reply.status === 200));
  assert.equal((await api(path + '/forecasts', { ...second, name: 'rhea' })).status, 409);
  assert.deepEqual((await api(path + '/status')).data, { phase: 'open', entries: 2 });
  assert.equal((await api(path + '/settle', {})).status, 403);
  assert.equal((await api(path + '/settle', {}, 'wrong')).status, 403);

  await stop();
  await start();
  assert.deepEqual((await api(path)).data, { ...opened, entries: 2 });
  assert.equal((await api(path + '/settle', {}, hostToken)).status, 200);
  const settled = (await api(path)).data;
  assert.equal(settled.phase, 'settled');
  assert.equal(settled.entries, 2);
  assert.match(settled.seed, /^[a-f0-9]{64}$/);
  assert.equal(settled.frames.at(-1).tick, opened.endTick);
  assert.equal(settled.leaderboard.find(row => row.name === 'Rhea').points, 75);
  assert.deepEqual(settled.leaderboard.find(row => row.name === BOT_NAME).probabilities, botForecast(opened));
  assert.equal(verify(settled, commitment).checkedAgainstSavedCommitment, true);
  assert.throws(() => verify({ ...settled, seed: '0' }, commitment));
  const changed = structuredClone(settled);
  changed.frames.at(-1).food++;
  assert.throws(() => verify(changed, commitment));
  const refuge = (await api(path + '/refuge')).data;
  const expected = simulate(settled.seed, { intervention: 'refuge' }).frames.map(({tick,grazers,hunters,food}) =>
    ({tick,grazers,hunters,food}));
  assert.deepEqual(refuge.frames, expected);
  assert.equal((await api(path + '/settle', {}, hostToken)).status, 200);
  assert.equal((await api(path + '/forecasts', { ...first, name: 'Late' })).status, 409);
  await stop();
  await start();
  assert.deepEqual((await api(path)).data, settled);
});
