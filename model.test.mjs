import test from 'node:test';
import assert from 'node:assert/strict';
import {features,fit} from './model.mjs';

test('Field Agent only reads the opening population counts',()=>{
  const frames=[0,24,48].map(tick=>({tick,grazers:10+tick,hunters:4,food:100-tick}));
  assert.deepEqual(features([...frames,{tick:54,grazers:999,hunters:999,food:999}]),features(frames));
  assert.throws(()=>features(frames.slice(0,2)),/tick 48/);
});
test('nearest-neighbor model uses training scales, permits constant features, and shrinks extreme predictions',()=>{
  const rows=Array.from({length:24},(_,i)=>({x:[i<12?0:1,1],y:[i<12?0:1]}));
  const predict=fit(rows,['growth']);
  assert.equal(predict([0,1]).growth,1/14);
  assert.equal(predict([1,1]).growth,13/14);
});
