import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { BOT_NAME, botForecast } from './bot.mjs';
import { simulate, ENGINE_VERSION } from './engine.mjs';

function endpoint(value) {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Use the HTTP or HTTPS room link.');
  const code=url.searchParams.get('room') || url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/?$/)?.[1];
  if (!code || !/^[a-zA-Z0-9]+$/.test(code)) throw new Error('Paste the room link including ?room=CODE.');
  return url.origin+'/api/rooms/'+code;
}
async function json(url,options) {
  const response=await fetch(url,options);
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || data.message || String(response.status));
  return data;
}
export function verify(room,expectedCommitment) {
  assert.equal(room.phase,'settled','A settled receipt is required.');
  assert.equal(room.engineVersion,ENGINE_VERSION,'Use the engine version distributed with this room.');
  const hash=createHash('sha256').update(ENGINE_VERSION+':'+room.seed).digest('hex');
  assert.equal(hash,room.commitment,'Receipt commitment mismatch.');
  if(expectedCommitment) assert.equal(hash,expectedCommitment,'Pre-reveal commitment mismatch.');
  const world=simulate(room.seed);
  for(const key of ['width','height','biome','observationTick','endTick','terrain','frames','questions','events','outcomes'])
    assert.ok(Object.hasOwn(world,key) && isDeepStrictEqual(world[key],room[key]),'Replayed '+key+' differs.');
  let last=Infinity;
  assert.ok(Array.isArray(room.leaderboard) && room.leaderboard.length===room.entries+1,'Entrant count mismatch.');
  const bot=room.leaderboard.filter(entry=>entry.isBot);
  assert.ok(bot.length===1 && bot[0].name===BOT_NAME,'Expected one reference opponent.');
  const botTicket=botForecast({questions:world.questions, frames:world.frames.filter(f=>f.tick<=world.observationTick)});
  assert.deepEqual(bot[0].probabilities,botTicket,'Field Agent ticket differs from the reference calculation.');
  for(const entry of room.leaderboard) {
    const losses=world.questions.map(q=>{
      const p=entry.probabilities[q.id];
      assert.ok(Number.isFinite(p) && p>=0 && p<=1,'Invalid probability.');
      return (p-Number(world.outcomes[q.id]))**2;
    });
    const score=100*(1-losses.reduce((a,b)=>a+b,0)/losses.length);
    assert.ok(Math.abs(score-entry.points)<=0.0050001,'Score mismatch for '+entry.name);
    assert.ok(entry.points<=last,'Leaderboard order mismatch.');
    last=entry.points;
  }
  return {room:room.code,engine:ENGINE_VERSION,frames:world.frames.length,entries:room.entries,
    commitment:hash,checkedAgainstSavedCommitment:Boolean(expectedCommitment)};
}
async function main(args) {
  const [cmd,source,...rest]=args;
  if(cmd==='verify' && source) {
    const data=/^https?:\/\//.test(source) ? await json(endpoint(source)) : JSON.parse(readFileSync(source,'utf8'));
    console.log(JSON.stringify(verify(data,rest[0]),null,2)); return;
  }
  if(cmd==='observe' && source) {
    const r=await json(endpoint(source));
    const {code,phase,commitment,biome,questions}=r;
    const observations=r.frames.filter(f=>f.tick<=r.observationTick).map(({tick,grazers,hunters,food})=>({tick,grazers,hunters,food}));
    console.log(JSON.stringify({code,phase,commitment,biome,questions,observations},null,2)); return;
  }
  if(cmd==='forecast' && source && rest.length===4) {
    const [name,...strings]=rest;
    const r=await json(endpoint(source));
    if(r.phase!=='open') throw new Error('This room has settled.');
    const probs=strings.map(s=>s.trim()===''?NaN:Number(s));
    if(probs.some(v=>!Number.isFinite(v)||v<0||v>1)) throw new Error('Each probability must be between 0 and 1.');
    const probabilities=Object.fromEntries(r.questions.map((q,i)=>[q.id,probs[i]]));
    const reply=await json(endpoint(source)+'/forecasts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,probabilities})});
    console.log(JSON.stringify({room:r.code,commitment:r.commitment,name,probabilities,...reply},null,2)); return;
  }
  throw new Error('Usage: node cli.mjs observe ROOM_URL | forecast ROOM_URL NAME P1 P2 P3 | verify ROOM_URL_OR_RECEIPT [SAVED_COMMITMENT]');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
