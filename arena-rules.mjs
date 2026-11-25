export function observation(world) {
  const { width, height, biome, observationTick, endTick, terrain, questions, frames, events } = world;
  return { width, height, biome, observationTick, endTick, terrain, questions,
    frames: frames.filter(frame => frame.tick <= observationTick),
    events: events.filter(event => event.tick <= observationTick) };
}

export function normalizeEntry(questions, body) {
  const name = typeof body?.name === 'string' ? body.name.trim().normalize('NFC') : '';
  if (!name || name.length > 24 || /[\p{C}]/u.test(name)) {
    throw new Error('Choose a name between 1 and 24 visible characters.');
  }
  if (name.toLowerCase() === 'field agent') throw new Error('Field Agent is the benchmark bot. Choose another name.');
  const values = body.probabilities;
  if (!values || Array.isArray(values) || typeof values !== 'object' ||
      Object.keys(values).length !== questions.length) throw new Error('Enter a probability for every question.');
  const probabilities = {};
  for (const {id} of questions) {
    const value = values[id];
    if (!Object.hasOwn(values,id) || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Probabilities must be numbers between 0 and 1.');
    }
    probabilities[id] = value;
  }
  return { name, probabilities };
}

export function scoreEntries(questions, outcomes, entries) {
  return entries.map(entry => {
    const loss = questions.reduce((total, {id}) => total +
      (entry.probabilities[id] - Number(outcomes[id])) ** 2, 0) / questions.length;
    return {...entry, points: Number((100 * (1 - loss)).toFixed(2))};
  }).sort((a, b) => b.points - a.points);
}
