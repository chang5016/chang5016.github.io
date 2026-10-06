type Point={x:number;z:number};
/** Round only junction corners, not entire straight blocks or over-large swooping paths. */
export function smoothTrafficPoints(points:Point[],width:number):Point[] {
  if(points.length<3)return points;
  const out=[points[0]];
  for(let i=1;i<points.length-1;i++) {
    const a=points[i-1],p=points[i],b=points[i+1],la=Math.hypot(p.x-a.x,p.z-a.z),lb=Math.hypot(b.x-p.x,b.z-p.z);
    if(la<.1||lb<.1||((p.x-a.x)*(b.x-p.x)+(p.z-a.z)*(b.z-p.z))/(la*lb)>.9999){out.push(p);continue;}
    // A passenger car needs a real turning radius, including its inside lane.
    // The curve stays inside the junction and begins only near its approach.
    const r=Math.min(11,width*1.1,la*.24,lb*.24);
    if(r<.1){out.push(p);continue;}
    const incoming={x:p.x+(a.x-p.x)*r/la,z:p.z+(a.z-p.z)*r/la},outgoing={x:p.x+(b.x-p.x)*r/lb,z:p.z+(b.z-p.z)*r/lb};
    out.push(incoming);
    const samples=Math.max(8,Math.ceil(r*1.7/.35));
    for(let j=1;j<=samples;j++){const t=j/samples,u=1-t;out.push({x:u*u*incoming.x+2*u*t*p.x+t*t*outgoing.x,z:u*u*incoming.z+2*u*t*p.z+t*t*outgoing.z});}
  }
  out.push(points[points.length-1]);return out;
}
