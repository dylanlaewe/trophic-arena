// Each feature is available to every entrant before the observation cutoff.
export function features(frames) {
  return [0,24,48].flatMap(tick => {
    const frame = frames.find(f => f.tick === tick);
    if (!frame) throw new Error('Missing observation at tick ' + tick);
    return [frame.grazers,frame.hunters,frame.food].map(Math.log1p);
  });
}

export function fit(rows, keys) {
  if (rows.length < 12) throw new Error('Field Agent requires at least 12 reference worlds.');
  const means = rows[0].x.map((_, i) => rows.reduce((s,r) => s + r.x[i],0) / rows.length);
  const scales = means.map((mean,i) => Math.sqrt(rows.reduce((s,r) => s + (r.x[i]-mean)**2,0)/rows.length) || 1);
  const prior = keys.map((_,i) => rows.reduce((s,r) => s+r.y[i],0)/rows.length);
  return x => {
    const near = rows.map(row => ({
      distance: row.x.reduce((s,value,i) => s+((x[i]-value)/scales[i])**2,0), outcomes:row.y
    })).sort((a,b) => a.distance-b.distance).slice(0,12);
    // Two pseudo-observations at the training prevalence dampen extreme bets.
    return Object.fromEntries(keys.map((key,i) => {
      const hits=near.reduce((sum,row) => sum+row.outcomes[i],0);
      return [key,(hits+2*prior[i])/(near.length+2)];
    }));
  };
}
