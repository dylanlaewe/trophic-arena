import { comparisonPlot } from './comparison.js';
import { renderWorld, drawChart } from './world.js';

const solo = document.documentElement.dataset.mode === 'solo' ? await import('./solo.js') : null;
const el = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const saved = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
let room, code, hostToken, entryName, frameIndex = 0, playing = false, timer, polling = false;
let refreshGeneration = 0, replayURL;
const media = matchMedia('(prefers-reduced-motion: reduce)');
const stepMs = () => room?.phase === 'settled' ? 230 : 590;

async function request(path, body, token) {
  if (solo) return solo.request(path, body);
  const options = { cache: 'no-store', headers: {} };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
    if (token) options.headers.Authorization = 'Bearer ' + token;
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed (' + response.status + ').');
  return data;
}
const path = () => '/api/rooms/' + encodeURIComponent(code);
const notify = text => { el('message').textContent = text; };
const link = () => new URL(solo ? '?challenge=' + solo.challenge() : '?room=' + encodeURIComponent(code), location.href).href;

function stop() {
  cancelAnimationFrame(timer);
  playing = false;
  el('play').textContent = 'Play';
  el('play').setAttribute('aria-label', 'Play tape');
}
function paint(index) {
  frameIndex = index;
  const frame = room.frames[index];
  renderWorld(el('world'), room, frame);
  drawChart(el('chart'), room.frames.slice(0, index + 1));
  el('tick').textContent = String(frame.tick).padStart(3, '0');
  el('timeline').value = index;
  el('timeline').setAttribute('aria-valuetext','Tick ' + frame.tick);
  el('grazer-count').textContent = frame.grazers;
  el('hunter-count').textContent = frame.hunters;
  el('food-count').textContent = frame.food;
  const feed = room.events.filter(event => event.tick <= frame.tick).slice(-3).reverse();
  el('event-list').replaceChildren(...feed.map(event => {
    const row = make('li');
    row.append(make('span', 'T+' + String(event.tick).padStart(3,'0'),'event-tick'),make('span',event.text));
    return row;
  }));
}
function play() {
  if (!room || !room.frames.length) return;
  if (playing) { stop(); return; }
  if (frameIndex === room.frames.length - 1) paint(0);
  playing = true;
  el('play').textContent = 'Pause';
  el('play').setAttribute('aria-label','Pause tape');
  let since = performance.now();
  const advance = now => {
    if (!playing) return;
    const alpha = Math.min(1,(now-since)/stepMs());
    if (alpha >= 1) {
      paint(frameIndex+1);
      if (frameIndex >= room.frames.length-1) { stop(); return; }
      since = now;
    } else if (!media.matches) {
      renderWorld(el('world'),room,room.frames[frameIndex+1],room.frames[frameIndex],alpha);
    }
    timer = requestAnimationFrame(advance);
  };
  timer = requestAnimationFrame(advance);
}
function inputs() {
  return Object.fromEntries(room.questions.map(q => [q.id,Number(el('p-'+q.id).value)/100]));
}
function buildQuestions() {
  const previous = saved('trophic:entry:'+code);
  let values;
  try { values = previous && JSON.parse(previous).probabilities; } catch {}
  const rows = room.questions.map(q => {
    const box = make('div',undefined,'question');
    const label = make('label',q.label);
    const slider = make('input');
    const output = make('output');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.id = 'p-'+q.id; slider.value = Math.round((values?.[q.id] ?? 0.5)*100);
    label.htmlFor = slider.id; output.htmlFor = slider.id;
    const rule = make('p',q.detail,'rule');
    rule.id = 'rule-'+q.id; slider.setAttribute('aria-describedby',rule.id);
    const update = () => {
      output.value = slider.value+'%';
      slider.setAttribute('aria-valuetext',slider.value+' percent probability of yes');
      slider.style.setProperty('--p',output.value);
    };
    update(); slider.addEventListener('input',update);
    box.append(label,output,slider,rule);
    return box;
  });
  el('questions').replaceChildren(...rows);
}
function controls() {
  const open = room.phase === 'open';
  el('stage').textContent = open ? 'Forecasts open' : 'Round settled';
  el('entries').textContent = room.entries + (room.entries === 1 ? ' entry' : ' entries');
  el('settle').hidden = !hostToken || !open;
  el('settle').disabled = room.entries === 0;
  // Lock the local ticket immediately after acceptance.
  for (const control of el('forecast-form').querySelectorAll('input,button')) control.disabled = !open || !!entryName;
  el('submit').textContent = entryName ? 'Forecast locked' : (open ? 'Lock forecast' : 'Forecasts closed');
  if (!open && el('result').hidden) showResult();
}
function showResult() {
  el('result').hidden = false;
  const table = make('table');
  const head = table.createTHead().insertRow();
  for (const title of ['Rank','Forecaster','Score / 100']) {
    const th = make('th',title); th.scope = 'col'; head.append(th);
  }
  const body = table.createTBody();
  let last, rank;
  room.leaderboard.forEach((r,i) => {
    if (r.points !== last) rank = i+1;
    last = r.points;
    const row = body.insertRow();
    if (r.name === entryName) row.className = 'is-you';
    row.insertCell().textContent = String(rank).padStart(2,'0');
    row.insertCell().textContent = r.name + (r.name === entryName ? ' (you)' : '');
    row.insertCell().textContent = Number(r.points).toFixed(2);
  });
  const outcomes = make('ul',undefined,'resolved-questions');
  const myEntry = room.leaderboard.find(r => r.name === entryName);
  const bot = room.leaderboard.find(r => r.isBot);
  for (const q of room.questions) {
    const row = make('li');
    row.append(make('strong',room.outcomes[q.id] ? 'YES' : 'NO'),make('span',q.label));
    const calls = [];
    if (myEntry) calls.push('You '+Math.round(myEntry.probabilities[q.id]*100)+'%');
    if (bot) calls.push(bot.name+' '+Math.round(bot.probabilities[q.id]*100)+'%');
    if (calls.length) row.append(make('small',calls.join(' · ')));
    outcomes.append(row);
  }
  el('ledger').replaceChildren(table,outcomes);
  const details = make('details');
  details.append(make('summary','Inspect seed & commitment'),make('p','Seed'),make('code',room.seed),make('p','SHA-256 commitment · '+room.engineVersion),make('code',room.commitment));
  const anchor = make('a','Download replay receipt');
  anchor.download = 'trophic-'+room.code+'.json';
  if (replayURL) URL.revokeObjectURL(replayURL);
  anchor.href = replayURL = URL.createObjectURL(new Blob([JSON.stringify(room)],{type:'application/json'}));
  el('proof').replaceChildren(details,anchor);
}
function publicProof() {
  const details = make('details');
  details.append(make('summary',solo ? 'Practice world fingerprint' : 'Sealed seed · view commitment'),make('code',room.commitment),
    make('p','Save this SHA-256 fingerprint before the reveal to check the seed later.'));
  el('proof').replaceChildren(details);
}
async function refresh(checkStatus = false) {
  if (!code || polling) return;
  const generation = refreshGeneration;
  polling = true;
  try {
    if (checkStatus && room) {
      const status = await request(path() + '/status');
      if (generation !== refreshGeneration) return;
      if (status.phase === room.phase) { room.entries = status.entries; controls(); return; }
    }
    const data = await request(path());
    if (generation !== refreshGeneration) return;
    const first = !room, changed = first || room.phase !== data.phase;
    if (!changed) { room.entries = data.entries; controls(); return; }
    room = data;
    el('room-code').textContent = room.code;
    el('biome').textContent = room.biome;
    el('share').disabled = false; el('play').disabled = false; el('timeline').disabled = false;
    el('timeline').min = '0'; el('timeline').max = room.frames.length-1;
    if (first) {
      buildQuestions();
      el('player-name').value = entryName || saved('trophic:name') || '';
    }
    controls();
    if (data.phase === 'open') {
      publicProof();
      if (solo) notify(entryName ? 'Forecast locked. Reveal the world to see how you scored.' : 'Solo practice. Watch the opening, then enter your three probabilities.');
      else if (entryName) notify('Locked for '+entryName+'. The host can reveal when everyone is in.');
      else notify(hostToken ? 'You host this round. Share it or play solo.' : 'Choose your probabilities before the host reveals the seed.');
    } else {
      notify('Round settled. The full tape and scores are ready.');
    }
    stop();
    if (first && data.phase === 'open' && !media.matches) { paint(0); play(); }
    else if (first || media.matches) paint(room.frames.length-1);
    else { paint(room.frames.findIndex(f => f.tick === room.observationTick)); play(); }
  } finally { if (generation === refreshGeneration) polling = false; }
}
async function enter(roomCode, token) {
  refreshGeneration++;
  stop(); polling = false; room = null; code = roomCode;
  hostToken = token || saved('trophic:host:'+code);
  let receipt;
  try { receipt = JSON.parse(saved('trophic:entry:'+code)); } catch {}
  entryName = receipt?.name;
  el('result').hidden = true;
  if (replayURL) { URL.revokeObjectURL(replayURL); replayURL = undefined; }
  el('experiment').replaceChildren();
  el('refuge').disabled = false;
  el('settle').hidden = true;
  await refresh();
}
async function newRoom(seed) {
  el('new-room').disabled = true;
  try {
    const data = solo ? await solo.create(seed) : await request('/api/rooms',{});
    save('trophic:host:'+data.code,data.hostToken);
    const url = new URL(location.href); url.search = ''; url.searchParams.set(solo ? 'challenge' : 'room',solo ? solo.challenge() : data.code); url.hash='';
    if (code) history.pushState(null,'',url); else history.replaceState(null,'',url);
    await enter(data.code,data.hostToken);
  } catch (e) { notify(e.message); }
  finally { el('new-room').disabled = false; }
}
el('forecast-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (!room || room.phase !== 'open' || entryName) return;
  const name=el('player-name').value.trim(), probabilities=inputs();
  if (!name) { el('player-name').focus(); return; }
  const submittedCode=code;
  el('submit').disabled=true;
  try {
    const accepted = await request(path()+'/forecasts',{name,probabilities});
    const canonical = accepted.name ?? name.normalize('NFC');
    save('trophic:entry:'+submittedCode,JSON.stringify({name:canonical,probabilities})); save('trophic:name',canonical);
    if (code !== submittedCode) return;
    entryName=canonical; el('player-name').value=canonical; controls();
    notify('Forecast locked for '+name+'. '+(solo ? 'Reveal the world to score it.' : hostToken ? 'Reveal when everyone is in.' : 'Waiting for the host to reveal.'));
    await refresh();
  } catch(e) { if (code === submittedCode) { controls(); notify(e.message); } }
});
el('settle').addEventListener('click',async () => {
  const generation = refreshGeneration;
  el('settle').disabled=true;
  try {
    await request(path()+'/settle',{},hostToken);
    if (generation === refreshGeneration) await refresh();
  } catch(e) { if (generation === refreshGeneration) { controls(); notify(e.message); } }
});
el('refuge').addEventListener('click', async () => {
  if (room?.phase !== 'settled') return;
  const generation = refreshGeneration;
  el('refuge').disabled = true;
  try {
    const branch = await request(path()+'/refuge');
    if (generation !== refreshGeneration) return;
    const base = room.frames.at(-1), alternate = branch.frames.at(-1);
    const table = make('table');
    const head = table.createTHead().insertRow();
    for (const label of ['At tick '+base.tick, 'Original', 'Refuge', 'Change']) {
      const th = make('th',label); th.scope = 'col'; head.append(th);
    }
    const body = table.createTBody();
    for (const [key,label] of [['grazers','Grazers'],['hunters','Hunters'],['food','Food patches']]) {
      const delta = alternate[key] - base[key];
      const row = body.insertRow();
      for (const value of [label,base[key],alternate[key],(delta > 0 ? '+' : '')+delta]) row.insertCell().textContent = value;
    }
    el('experiment').replaceChildren(comparisonPlot(room.frames,branch.frames,room.observationTick),table);
  } catch (e) { if (generation === refreshGeneration) { el('refuge').disabled = false; notify(e.message); } }
});
el('new-room').addEventListener('click',()=>newRoom());
el('share').addEventListener('click',async () => {
  try {
    await navigator.clipboard.writeText(link());
    if (solo) { notify('Challenge copied. A friend can forecast this same world in their browser.'); return; }
    notify(['localhost','127.0.0.1','[::1]'].includes(location.hostname)
      ? 'Room link copied. This address works on this computer. For group play, open the LAN address first (see Field guide).'
      : 'Room link copied. Anyone with it can submit a forecast.');
  } catch {
    const input=make('input'); input.readOnly=true; input.value=link(); input.setAttribute('aria-label','Copy room link');
    el('message').replaceChildren(input); input.focus(); input.select();
  }
});
el('timeline').addEventListener('input',() => { if(room) { stop(); paint(Number(el('timeline').value)); } });
el('play').addEventListener('click',play);
el('help').addEventListener('click',()=>el('guide').showModal());
el('guide').addEventListener('click',e=>{ if(e.target===el('guide')) el('guide').close(); });
window.addEventListener('resize',()=>{if(room) paint(frameIndex);});
window.addEventListener('popstate',()=>location.reload());
const requested = new URLSearchParams(location.search).get('room');
try {
  if (solo) {
    el('share').title = 'Copy solo challenge link';
    el('share').setAttribute('aria-label', 'Copy solo challenge link');
    await newRoom(new URLSearchParams(location.search).get('challenge') ?? undefined);
  } else if (requested) await enter(requested.trim().toUpperCase());
  else await newRoom();
} catch(e) { notify(e.message+' Start a new room to play.'); }
setInterval(()=>{ if(!solo && !document.hidden && room?.phase==='open') refresh(true).catch(e=>notify(e.message)); },2500);
