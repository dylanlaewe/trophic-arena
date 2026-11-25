const TAU = 2 * Math.PI;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const mix = (a, b, t) => a + (b - a) * t;
const terrainCache = new WeakMap();
const frameLookup = new WeakMap();
const sprites = new Map();

// Stable paint texture. The simulation itself supplies every cell and organism.
function hash(n) {
  let value = n | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
function surface(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}
function ellipse(ctx, x, y, rx, ry, angle, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fill();
}
function stroke(ctx, coords, color, thickness) {
  ctx.strokeStyle = color; ctx.lineWidth = thickness;
  ctx.beginPath(); ctx.moveTo(coords[0], coords[1]);
  for (let i = 2; i < coords.length; i += 2) ctx.lineTo(coords[i], coords[i+1]);
  ctx.stroke();
}

const water = [30, 63, 63];
const palettes = {
  'Copper Steppe': [water, [101, 104, 75], [103, 111, 66], [145, 117, 81]],
  'Sedge Marsh': [water, [79, 101, 73], [77, 106, 68], [122, 120, 83]],
  'Emerald Basin': [water, [89, 111, 76], [76, 105, 65], [115, 121, 81]]
};
function makeTerrain(room) {
  const {width, height, terrain} = room;
  const scale = 18;
  const atlas = surface(width * scale, height * scale);
  const ctx = atlas.getContext('2d');
  const raster = ctx.createImageData(atlas.width, atlas.height);
  const pixels = raster.data;
  const palette = palettes[room.biome] || palettes['Emerald Basin'];
  // Slight jitter breaks the visual lattice while preserving each cell centre.
  const offsets = terrain.map((_, i) => (hash(i * 73 + 103) - 0.5) * .28);
  const at = (x, y) => {
    const i = clamp(Math.floor(x), 0, width - 1) + width * clamp(Math.floor(y), 0, height - 1);
    return terrain[i] + offsets[i];
  };
  function elevation(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
    return mix(mix(at(ix, iy), at(ix+1, iy), tx), mix(at(ix, iy+1), at(ix+1, iy+1), tx), ty);
  }
  const heights = new Float32Array(atlas.width * atlas.height);
  for (let y = 0; y < atlas.height; y++) {
    for (let x = 0; x < atlas.width; x++) {
      const gx = x / scale - .5, gy = y / scale - .5;
      heights[x + y * atlas.width] = elevation(gx + .075 * Math.sin(gy * 1.5 + gx * 2.2), gy + .055 * Math.cos(gx * 2.6 - gy * 1.4));
    }
  }
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i], level = clamp(h, 0, 3), band = Math.min(2, Math.floor(level));
    const x = i % atlas.width, y = Math.floor(i / atlas.width);
    const left = heights[Math.max(0, i - (x ? 1 : 0))];
    const above = heights[Math.max(0, i - (y ? atlas.width : 0))];
    const slope = (h - left) * .9 + (h - above) * 1.2;
    const relief = Math.min(1, Math.abs(h-left) * 13 + Math.abs(h-above) * 13);
    const contour = Math.min(1, Math.abs(Math.sin(h * Math.PI * 4.5)) * 2.4);
    const dapple = Math.sin(x * .049 + Math.sin(y * .07)) * 2.3 + Math.cos(y * .036 - x * .027) * 2;
    const grain = (hash(i * 21) - .5) * 9 + dapple;
    const shore = Math.max(0, 1 - Math.abs(h - .53) * 11);
    const shade = clamp(slope * 102, -20, 18) - (1-contour) * relief * 15 + grain + shore * 15;
    for (let c = 0; c < 3; c++) {
      pixels[i*4+c] = clamp(mix(palette[band][c],palette[band+1][c], level-band) + shade, 0, 255);
    }
    pixels[i*4+3] = 255;
  }
  ctx.putImageData(raster, 0, 0);
  ctx.lineCap = 'round';
  // Rocks and short grass describe the terrain under the edible plant canopy.
  for (let i = 0; i < terrain.length; i++) {
    const cell = terrain[i];
    for (let n = 0; n < 4; n++) {
      const s = i * 127 + n * 13;
      const px = (i % width + hash(s+1)) * scale;
      const py = (Math.floor(i/width) + hash(s+2)) * scale;
      const size = 1 + hash(s+3) * 2.8;
      if (cell === 0) {
        stroke(ctx,[px-size,py,px,py+.4,px+size*1.6,py-.4],'rgba(145,202,176,.15)',.8);
      } else if (cell === 3 && n % 2 === 0) {
        ellipse(ctx,px+1,py+.7,size*1.35,size*.65,-.3,'rgba(42,55,36,.28)');
        ellipse(ctx,px,py,size*1.1,size*.61,-.3,'rgba(193,187,128,.47)');
      } else {
        stroke(ctx,[px-1,py-size*.6,px,py,px+size*.65,py-size],'rgba(39,65,37,.35)',.7);
      }
    }
  }
  return atlas;
}

function plantSprite(variant) {
  const key = 'plant' + variant;
  if (sprites.has(key)) return sprites.get(key);
  const sheet = surface(56,56), ctx = sheet.getContext('2d');
  ctx.translate(28,30); ctx.lineCap = 'round';
  ellipse(ctx,2,4,14,8,.2,'rgba(26,42,26,.46)');
  for (let n = 0; n < 6; n++) {
    const angle = n * TAU/6 + variant * .72;
    const length = 6 + hash(variant*29+n) * 6;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const colors = ['#436045','#5e8057','#486c50','#729466','#60895e','#577e55'];
    ellipse(ctx,dx*length*.57,dy*length*.57,length*.77,3.4,angle,colors[(n+variant)%6]);
    stroke(ctx,[dx,dy,dx*length,dy*length], 'rgba(159,192,125,.53)',.95);
  }
  ellipse(ctx,-1,-1,2.4,2.3,0,'#a9b87a');
  sprites.set(key,sheet); return sheet;
}

function creatureSprite(kind, trait) {
  const key = 'animal-' + kind + '-' + trait;
  if (sprites.has(key)) return sprites.get(key);
  const sheet = surface(84,72), ctx = sheet.getContext('2d');
  ctx.translate(42,36);
  ctx.lineJoin = ctx.lineCap = 'round';
  const hunter = kind === 1;
  const fur = hunter ? ['#e79c66','#d98762','#efad7d'][trait%3] : ['#d7de9a','#c8d49d','#e0dfa7'][trait%3];
  const dark = hunter ? '#714a39' : '#6d7951';
  const light = hunter ? '#ffd0a0' : '#f1f0c1';
  // Top-down silhouettes face right. Four limbs and a head stay visible at map scale.
  for (const side of [-1,1]) {
    stroke(ctx,[-6,side*3,-11,side*8,-15,side*9],dark,3.7);
    stroke(ctx,[5,side*3,8,side*8,13,side*9],dark,3.4);
    stroke(ctx,[-7,side*4,-12,side*8],fur,2.1);
    stroke(ctx,[7,side*4,11,side*8],fur,2.1);
  }
  if (hunter) {
    ctx.fillStyle = fur; ctx.beginPath(); ctx.moveTo(-6,-3);
    ctx.bezierCurveTo(-15,-8,-20,-2,-29,-6); ctx.bezierCurveTo(-23,4,-15,6,-5,4); ctx.fill();
    ctx.fillStyle = '#f1c59e'; ctx.beginPath(); ctx.moveTo(-28,-5); ctx.lineTo(-20,-3); ctx.lineTo(-23,0); ctx.closePath(); ctx.fill();
  } else {
    ellipse(ctx,-13,0,6,2.6,-.16,light);
  }
  ellipse(ctx,-1,0,hunter ? 12 : 13,hunter ? 5.8 : 7.3,0,dark);
  ellipse(ctx,-1,-.5,hunter ? 11.5 : 12.6,hunter ? 5.2 : 6.5,0,fur);
  ellipse(ctx,-3,-2,7.8,2.5,0,light);
  for (const side of [-1,1]) {
    if (hunter) {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(7,side*2); ctx.lineTo(8,side*9); ctx.lineTo(14,side*4); ctx.closePath(); ctx.fill();
    } else {
      ellipse(ctx,10,side*4,5,2.5,side*.75,fur);
      stroke(ctx,[12,side*2,15,side*6,14,side*9],dark,1.8);
    }
  }
  ellipse(ctx,12,.1,7.4,4.8,0,fur);
  ellipse(ctx,17,0,3.4,2.4,0,hunter ? dark : light);
  ellipse(ctx,14,-2.6,1.1,1.1,0,'#283325');
  ellipse(ctx,14,2.6,1.1,1.1,0,'#283325');
  sprites.set(key,sheet); return sheet;
}

function context(canvas) {
  const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
  const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(width*ratio), ph = Math.round(height*ratio);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pw/width,0,0,ph/height,0,0);
  return {ctx, width, height};
}
function agentsById(frame) {
  let index = frameLookup.get(frame);
  if (!index) { index = new Map(frame.agents.map(agent => [agent[0],agent])); frameLookup.set(frame,index); }
  return index;
}

export function renderWorld(canvas, room, frame, previous, alpha = 1) {
  const {ctx, width, height} = context(canvas);
  let atlas = terrainCache.get(room);
  if (!atlas) { atlas = makeTerrain(room); terrainCache.set(room,atlas); }
  ctx.drawImage(atlas,0,0,width,height);
  const cw = width/room.width, ch = height/room.height, cell = Math.min(cw,ch);
  for (const i of frame.plants) {
    const variation = i % 4;
    const jitter = (hash(i*3)-.5)*.35;
    const x = (i % room.width + .5 + jitter)*cw;
    const y = (Math.floor(i/room.width) + .5 + (hash(i*7)-.5)*.35)*ch;
    const size = cell*(1.1 + hash(i)*.55);
    ctx.drawImage(plantSprite(variation),x-size/2,y-size/2,size,size);
  }
  const prev = previous && agentsById(previous);
  for (const agent of frame.agents) {
    const [id, gx, gy, kind, trait] = agent;
    const last = prev?.get(id);
    const jx = (hash(id*3+75)-.5)*.32, jy = (hash(id*7+111)-.5)*.33;
    const x = ((last ? mix(last[1],gx,alpha) : gx) + .5 + jx)*cw;
    const y = ((last ? mix(last[2],gy,alpha) : gy) + .5 + jy)*ch;
    const moving = last && (last[1] !== gx || last[2] !== gy);
    const angle = moving ? Math.atan2((gy-last[2])*ch,(gx-last[1])*cw) : hash(id*73+991)*TAU;
    const size = cell*(kind === 1 ? 2.03 : 1.77)*(1+(trait-3)*.017);
    ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
    ellipse(ctx,-.06*cell,.07*cell,.44*cell,.23*cell,0,'rgba(14,31,20,.52)');
    ctx.drawImage(creatureSprite(kind,trait),-size/2,-size*3/7,size,size*6/7);
    ctx.restore();
  }
}

const tracks = [['food','#63b8a4'],['grazers','#c5eb8e'],['hunters','#ffa571']];
export function drawChart(canvas, frames) {
  const {ctx, width, height} = context(canvas);
  ctx.clearRect(0,0,width,height);
  if (!frames.length) return;
  const maximum = Math.max(10, ...frames.flatMap(frame => tracks.map(([key]) => frame[key])));
  const top = 4, bottom = height-5, left = 4, right = width-4;
  const end = Math.max(4,frames.at(-1).tick);
  ctx.lineWidth=1; ctx.strokeStyle='#354438';
  ctx.setLineDash([2,4]);
  for (let i = 0; i < 3; i++) {
    const y = top+(bottom-top)*i/2;
    ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const [key,color] of tracks) {
    ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.lineJoin='round'; ctx.beginPath();
    let x, y;
    for (let i = 0; i < frames.length; i++) {
      const f=frames[i]; x=left+f.tick/end*(right-left); y=bottom-f[key]/maximum*(bottom-top);
      if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    }
    ctx.stroke(); ellipse(ctx,x,y,2,2,0,color);
  }
  canvas.setAttribute('aria-label','Population history through tick '+frames.at(-1).tick+'. Vertical axis zero to '+maximum+'.');
}
