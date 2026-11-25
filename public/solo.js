// GitHub Pages practice mode. Worlds and tickets belong to this browser.
import { ENGINE_VERSION, simulate } from './engine.mjs';
import { fit, features } from './model.mjs';
import { normalizeEntry, observation, scoreEntries } from './arena-rules.mjs';

let active, world, predict;
const prefix = 'trophic:practice:' + ENGINE_VERSION + ':';
const memory = new Map();
function persist() {
  const data = JSON.stringify(active);
  memory.set(active.seed,data);
  try { localStorage.setItem(prefix + active.seed,data); } catch {}
}
async function open(seed) {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error('Invalid challenge link. Start a new world.');
  let previous;
  try { previous = JSON.parse(localStorage.getItem(prefix + seed)); } catch {}
  if (!previous && memory.has(seed)) previous = JSON.parse(memory.get(seed));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ENGINE_VERSION + ':' + seed));
  active = {seed, code:seed.slice(0,8).toUpperCase(), commitment:hex(new Uint8Array(hash)),
    entry:previous?.entry ?? null, settled:previous?.settled === true};
  world = simulate(seed);
  persist();
  return {code:active.code, hostToken:'practice'};
}
function hex(bytes) { return Array.from(bytes, n => n.toString(16).padStart(2,'0')).join(''); }
export const create = seed => open(seed ?? hex(crypto.getRandomValues(new Uint8Array(32))));
export const challenge = () => active.seed;

async function getPredictor() {
  if (!predict) {
    const response = await fetch(new URL('reference-worlds.json',import.meta.url));
    if (!response.ok) throw new Error('Could not load the benchmark bot. Try revealing again.');
    const model = await response.json();
    if (model.engineVersion !== ENGINE_VERSION) throw new Error('Reload to obtain the matching benchmark bot.');
    predict = fit(model.rows, model.keys);
  }
  return predict;
}
export async function request(path, body) {
  if (!active) throw new Error('Start a world first.');
  const phase = active.settled ? 'settled' : 'open';
  const entries = Number(!!active.entry);
  if (path.endsWith('/status')) return {phase,entries};
  if (path.endsWith('/refuge')) {
    if (!active.settled) throw new Error('Reveal the world to run an experiment.');
    return {frames:simulate(active.seed,{intervention:'refuge'}).frames.map(({tick,grazers,hunters,food})=>({tick,grazers,hunters,food}))};
  }
  if (path.endsWith('/forecasts')) {
    if (active.settled) throw new Error('This round has settled.');
    const entry = normalizeEntry(world.questions,body);
    if (active.entry && JSON.stringify(entry) !== JSON.stringify(active.entry)) throw new Error('A forecast is already locked.');
    active.entry = entry; persist(); return {accepted:true,name:entry.name};
  }
  if (path.endsWith('/settle')) {
    if (!active.entry) throw new Error('Lock a forecast before revealing.');
    const settling = active;
    await getPredictor();
    if (active !== settling) throw new Error('The active world changed.');
    active.settled = true; persist(); return {phase:'settled'};
  }
  const opening = observation(world);
  const base = {code:active.code, phase, entries, engineVersion:ENGINE_VERSION, commitment:active.commitment};
  if (!active.settled) return {...base,...opening};
  const ticket = active.entry, playedWorld = world, seed = active.seed;
  const forecast = await getPredictor();
  const bot = {name:'Field Agent',isBot:true,probabilities:forecast(features(opening.frames))};
  return {...base,...playedWorld,seed,leaderboard:scoreEntries(playedWorld.questions,playedWorld.outcomes,[ticket,bot])};
}
