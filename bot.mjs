import { readFileSync } from 'node:fs';
import { features, fit } from './model.mjs';
import { ENGINE_VERSION } from './engine.mjs';

export const BOT_NAME = 'Field Agent';
let predict;
export function botForecast(observation) {
  if (!predict) {
    const model=JSON.parse(readFileSync(new URL('./data/reference-worlds.json',import.meta.url),'utf8'));
    if(model.engineVersion !== ENGINE_VERSION) throw new Error('Rebuild the reference worlds for this engine version.');
    predict=fit(model.rows,model.keys);
  }
  const probabilities=predict(features(observation.frames));
  if(!observation.questions.every(q=>Object.hasOwn(probabilities,q.id))) throw new Error('Question set mismatch.');
  return probabilities;
}
