// A common vertical scale lets the two grazer trajectories be read directly.
export function comparisonPlot(original, refuge, cutoff) {
  const figure = document.createElement('figure');
  figure.style.margin = '1rem 0';
  const caption = document.createElement('figcaption');
  caption.textContent = 'Grazer population · solid green: refuge · dashed white: original';
  const ns = 'http://www.w3.org/2000/svg';
  const element = (name,attrs) => {
    const node = document.createElementNS(ns,name);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  };
  const plot = element('svg',{viewBox:'0 0 620 154',class:'comparison-chart',role:'img',
    'aria-label':'Grazer populations through time in the original and refuge worlds.'});
  plot.style.cssText = 'display:block;width:100%;max-width:760px';
  const max = Math.max(1,...original.map(f=>f.grazers),...refuge.map(f=>f.grazers));
  const end = original.at(-1).tick;
  const x = tick => 38 + 562 * tick/end;
  const y = pop => 122 - 108 * pop/max;
  const line = (a,b,c,d,stroke) => plot.append(element('line',{x1:a,y1:b,x2:c,y2:d,stroke}));
  const label = (left,top,value) => {
    const node = element('text',{x:left,y:top,fill:'#d5dfd5','font-size':14,'font-family':'monospace'});
    node.textContent = value;
    plot.append(node);
  };
  line(x(0),y(0),x(end),y(0),'#405648');
  line(x(cutoff),9,x(cutoff),123,'#708679');
  label(4,y(max)+5,max);
  label(13,y(0),0);
  label(x(0),145,'0');
  label(x(cutoff)-15,145,'refuge begins');
  label(x(end)-45,145,'T+'+end);
  for (const [frames,color,dash] of [[refuge,'#b9ec80','none'],[original,'#e9eee7','5 5']]) {
    plot.append(element('polyline',{points:frames.map(f=>x(f.tick)+','+y(f.grazers)).join(' '),
      fill:'none',stroke:color,'stroke-width':2.5,'stroke-dasharray':dash,'stroke-linejoin':'round'}));
  }
  figure.append(caption,plot);
  return figure;
}
