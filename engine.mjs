// Engine rules are part of each replay receipt. Bump this value when changing them.
export const ENGINE_VERSION = 'trophic-1';
const width = 36, height = 24, size = width * height;
const observationTick = 48, endTick = 192;

const questions = [
  { id: 'grazerRecovery', label: 'Will grazers regain ground?', detail: 'YES if the grazer count at tick 192 exceeds the count at tick 48.' },
  { id: 'hunterSurvival', label: 'Will hunters reach tick 128?', detail: 'YES if at least one hunter is alive at tick 128.' },
  { id: 'greenFinish', label: 'Will plants cover 300 cells?', detail: 'YES if at least 300 cells hold plants at tick 192.' }
];

// Expand the whole seed into four state words. sfc32 uses integer operations only.
function randomStream(seed) {
  if (typeof seed !== 'string' || !seed.length) throw new TypeError('Provide a nonempty seed string.');
  // Four lanes retain independent seed information across the 128-bit PRNG state.
  const words = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344];
  for (let i = 0; i < seed.length; i++) {
    const lane = i & 3;
    words[lane] = Math.imul(words[lane] ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  let [a,b,c,d] = words;
  function draw(limit) {
    const value = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (((c << 21) | (c >>> 11)) + value) | 0;
    return Math.floor((value >>> 0) * limit / 4294967296);
  }
  for (let step = 0; step < 20; step++) draw(1);
  return draw;
}

function landscape(next) {
  const stride = 6;
  const columns = Math.ceil(width / stride) + 1;
  const noise = Array.from({length: columns * (Math.ceil(height / stride) + 1)}, () => next(128));
  const land = [], terrain = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x % stride, gy = y % stride;
      const i = Math.floor(y / stride) * columns + Math.floor(x / stride);
      const top = noise[i] * (stride - gx) + noise[i + 1] * gx;
      const bottom = noise[i + columns] * (stride - gx) + noise[i + columns + 1] * gx;
      const elevation = (top * (stride - gy) + bottom * gy) / (stride * stride);
      // A small permanently dry ridge keeps even the wettest seed inhabitable.
      const ridge = Math.abs(x - 18) + Math.abs(y - 12) < 5;
      const cell = ridge ? 3 : elevation < 38 ? 0 : elevation < 50 ? 1 : elevation < 85 ? 2 : 3;
      terrain.push(cell);
      if (cell) land.push(x + y * width);
    }
  }
  const adjacent = terrain.map((cell, i) => {
    const options = [i];
    if (!cell) return options;
    if (i % width > 0 && terrain[i-1]) options.push(i-1);
    if (i % width < width-1 && terrain[i+1]) options.push(i+1);
    if (i >= width && terrain[i-width]) options.push(i-width);
    if (i < size-width && terrain[i+width]) options.push(i+width);
    return options;
  });
  return {terrain, land, adjacent};
}

export function simulate(seed, {intervention} = {}) {
  if (intervention !== undefined && intervention !== 'refuge') throw new Error('Unknown intervention.');
  const next = randomStream(seed);
  // The experiment and control receive identical weather and plant-growth attempts.
  const growthRandom = randomStream('growth/' + seed);
  const {terrain, land, adjacent} = landscape(next);
  const rainfall = 10 + next(26);
  const biome = rainfall < 18 ? 'Copper Steppe' : rainfall < 27 ? 'Sedge Marsh' : 'Emerald Basin';
  const shockStart = 64 + next(40), shockLength = 20 + next(26);
  const wetSpell = next(2) === 1;
  const plants = new Uint8Array(size);
  const founders = [24 + next(26), 3 + next(7)];
  const events = [{tick: 0, text: 'Founder populations released onto the floodplain.'}];
  const frames = [];
  let animals = [], nextId = 1;
  for (const cell of land) plants[cell] = Number(next(100) < (terrain[cell] === 2 ? 45 : 23));
  for (let kind = 0; kind <= 1; kind++) {
    for (let i = 0; i < founders[kind]; i++) {
      animals.push({id: nextId++, kind, cell: land[next(land.length)], energy: 24 + next(28), age: next(18), trait: next(8)});
    }
  }
  function snapshot(tick) {
    const agents = animals.map(a => [a.id, a.cell % width, Math.floor(a.cell / width), a.kind, a.trait]);
    const vegetation = land.filter(cell => plants[cell] > 0);
    const grazers = agents.reduce((n, agent) => n + Number(agent[3] === 0), 0);
    frames.push({tick, grazers, hunters: agents.length - grazers, food: vegetation.length, agents, plants: vegetation});
  }
  snapshot(0);
  const born = [false,false], extinct = [false,false];
  const hunterMap = new Uint16Array(size), scent = new Uint16Array(size);
  for (let tick = 1; tick <= endTick; tick++) {
    const refuge = intervention === 'refuge' && tick > observationTick;
    if (refuge && tick === observationTick + 1) events.push({tick, text: 'Highland refuge established. Grazers here are protected from predation.'});
    const shock = tick >= shockStart && tick < shockStart + shockLength;
    if (tick === shockStart) events.push({tick, text: wetSpell ? 'Rain front arrives. Plant growth intensifies.' : 'Dry front arrives. Plant growth slows.'});
    if (tick === shockStart + shockLength) events.push({tick, text: 'The weather front clears. Baseline growth resumes.'});
    const growth = shock ? (wetSpell ? rainfall * 2 : Math.ceil(rainfall / 4)) : rainfall;
    for (let j = 0; j < growth; j++) {
      const cell = land[growthRandom(land.length)];
      if (terrain[cell] === 2 || growthRandom(3) !== 0) plants[cell] = 1;
    }
    hunterMap.fill(0);
    scent.fill(0);
    for (const a of animals) if (a.kind === 1) hunterMap[a.cell]++;
    const prey = new Map();
    for (const a of animals) {
      if (a.kind !== 0) continue;
      const options = adjacent[a.cell];
      let best = a.cell, value = -Infinity;
      for (const cell of options) {
        const score = next(16) + plants[cell] * (6 + a.trait) - hunterMap[cell] * 18;
        if (score > value) { value = score; best = cell; }
      }
      a.cell = best;
      if (plants[best]) { a.energy += 8; plants[best] = 0; }
      if (!prey.has(best)) prey.set(best, []);
      prey.get(best).push(a);
      for (const cell of adjacent[best]) scent[cell]++;
    }
    for (const a of animals) {
      if (a.kind !== 1) continue;
      const options = adjacent[a.cell];
      let best = a.cell, value = -Infinity;
      for (const cell of options) {
        const count = prey.get(cell)?.length || 0;
        const score = next(19) + Math.min(3, scent[cell]) * (2 + a.trait) + Math.min(1, count) * 22;
        if (score > value) { value = score; best = cell; }
      }
      a.cell = best;
      const victim = refuge && terrain[best] === 3 ? undefined : prey.get(best)?.pop();
      if (victim) {
        victim.energy = -1;
        a.energy += 34;
        for (const cell of adjacent[best]) scent[cell]--;
      }
    }
    const survivors = [], offspring = [];
    for (const a of animals) {
      a.age++;
      // Greater sensory sensitivity improves steering but costs energy.
      a.energy -= (a.kind === 0 ? 3 : 2) + Number(a.trait >= 5 && tick % 4 === 0);
      if (a.energy <= 0 || a.age > (a.kind === 0 ? 76 : 112)) continue;
      if (a.age >= 8 && a.energy >= (a.kind === 0 ? 58 : 76)) {
        const share = Math.floor(a.energy / 2);
        a.energy -= share;
        const mutation = next(8) === 0 ? (next(2) === 0 ? -1 : 1) : 0;
        const trait = Math.max(0, Math.min(7, a.trait + mutation));
        offspring.push({id: nextId++, kind: a.kind, cell: a.cell, energy: share, age: 0, trait});
        if (!born[a.kind]) {
          events.push({tick, text: a.kind === 0 ? 'First grazer calf born.' : 'First hunter pup born.'});
          born[a.kind] = true;
        }
      }
      survivors.push(a);
    }
    animals = survivors.concat(offspring);
    for (let kind = 0; kind <= 1; kind++) {
      if (!extinct[kind] && !animals.some(a => a.kind === kind)) {
        events.push({tick, text: kind === 0 ? 'The last grazer dies.' : 'The last hunter dies.'});
        extinct[kind] = true;
      }
    }
    if (tick % 4 === 0) snapshot(tick);
  }
  const final = frames[frames.length - 1];
  const observed = frames.find(f => f.tick === observationTick);
  const outcomes = {grazerRecovery: final.grazers > observed.grazers, hunterSurvival: frames.find(f => f.tick === 128).hunters > 0, greenFinish: final.food >= 300};
  return {width, height, biome, observationTick, endTick, terrain, frames, questions: questions.map(q => ({...q})), events, outcomes};
}
