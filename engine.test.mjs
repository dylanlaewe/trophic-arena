import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {simulate, ENGINE_VERSION} from './engine.mjs';

test('public replay matches the versioned reference world byte for byte', () => {
  assert.equal(ENGINE_VERSION, 'trophic-1');
  const checksum = createHash('sha256').update(JSON.stringify(simulate('estuary'))).digest('hex');
  assert.equal(checksum, '4a38368362b2476ec9439147e05ee811f04437ec1f99d1b9bd9f90be73e24632');
});

test('agents, plants and settlement agree with each replay frame', () => {
  for (let i = 0; i < 20; i++) {
    const world = simulate('invariants/' + i);
    const {width, height, frames, terrain} = world;
    assert.equal(terrain.length, width * height);
    assert.equal(frames.length, 49);
    frames.forEach((frame, index) => {
      assert.equal(frame.tick, index * 4);
      assert.equal(frame.plants.length, frame.food);
      assert.equal(new Set(frame.plants).size, frame.food);
      for (const cell of frame.plants) assert.ok(terrain[cell] > 0);
      assert.equal(new Set(frame.agents.map(([id]) => id)).size, frame.agents.length);
      const kinds = [0,0];
      for (const [,x,y,kind,trait] of frame.agents) {
        assert.ok(x >= 0 && x < width && y >= 0 && y < height && terrain[y * width + x] > 0);
        assert.ok((kind === 0 || kind === 1) && Number.isInteger(trait) && trait >= 0 && trait <= 7);
        kinds[kind]++;
      }
      assert.deepEqual(kinds, [frame.grazers,frame.hunters]);
    });
    const final = frames.at(-1);
    assert.deepEqual(world.outcomes, {
      grazerRecovery: final.grazers > frames[12].grazers,
      hunterSurvival: frames[32].hunters > 0,
      greenFinish: final.food >= 300
    });
  }
});

test('refuge begins after lock and preserves initial evidence and weather', () => {
  const base = simulate('refuge-spec');
  const branch = simulate('refuge-spec', {intervention:'refuge'});
  const early = w => w.frames.filter(f => f.tick <= w.observationTick);
  const before = w => w.events.filter(e => e.tick <= w.observationTick);
  const weather = w => w.events.filter(e => /front /.test(e.text));
  assert.deepEqual(base.terrain, branch.terrain);
  assert.deepEqual(early(base), early(branch));
  assert.deepEqual(before(base), before(branch));
  assert.deepEqual(weather(base), weather(branch));
  assert.equal(branch.events.find(e => /refuge/.test(e.text)).tick, 49);
  assert.notDeepEqual(base.frames.at(-1), branch.frames.at(-1));
  assert.deepEqual(simulate('refuge-spec', {intervention:'refuge'}), branch);
});

test('invalid experimental conditions fail explicitly', () => {
  assert.throws(() => simulate('x', {intervention: 'typo'}), /Unknown intervention/);
  assert.throws(() => simulate(''), /seed/);
});
