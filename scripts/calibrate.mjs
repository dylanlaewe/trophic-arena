import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulate, ENGINE_VERSION } from '../engine.mjs';
import { fit, features } from '../model.mjs';

const dir=new URL('../data/',import.meta.url);
const trainingCount=128, heldOutCount=64;
function sample(split,index) {
  const seed=createHash('sha256').update('trophic-arena/field-agent/v1/'+split+'/'+index).digest('hex');
  const world=simulate(seed);
  const keys=world.questions.map(q=>q.id);
  return {keys,x:features(world.frames),y:keys.map(key=>Number(world.outcomes[key]))};
}
const training=Array.from({length:trainingCount},(_,i)=>sample('train',i));
const keys=training[0].keys;
const rows=training.map(({x,y})=>({x,y}));
const predict=fit(rows,keys);
const prevalence=keys.map((_,i)=>rows.reduce((sum,r)=>sum+r.y[i],0)/rows.length);
const metrics=keys.map(id=>({id,yes:0,bot:0,baseRate:0,coin:0.25}));
for(let i=0;i<heldOutCount;i++) {
  const {x,y}=sample('holdout',i);
  const p=predict(x);
  metrics.forEach((m,j)=>{
    m.yes+=y[j];
    m.bot+=(p[m.id]-y[j])**2/heldOutCount;
    m.baseRate+=(prevalence[j]-y[j])**2/heldOutCount;
  });
}
const mean=field=>metrics.reduce((sum,m)=>sum+m[field],0)/keys.length;
const report={engineVersion:ENGINE_VERSION,trainingWorlds:trainingCount,holdoutWorlds:heldOutCount,neighbors:12,
  brier:{fieldAgent:mean('bot'),trainingPrevalence:mean('baseRate'),always50:0.25},byQuestion:metrics};
mkdirSync(dir,{recursive:true});
writeFileSync(new URL('reference-worlds.json',dir),JSON.stringify({engineVersion:ENGINE_VERSION,keys,rows})+'\n');
writeFileSync(new URL('benchmark.json',dir),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
