(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MaxPinchMath=api;})(typeof window!=='undefined'?window:this,()=>{
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const limit=(x,y,rx,ry)=>{const length=Math.hypot(x/rx,y/ry),scale=length>.42?.42/length:1;return {x:x*scale,y:y*scale};};
  const chinResponse = .72;
  function localSourcePoint(x,y,p,w,h){
    if (p.chin) {
      const across = 1 - smooth(.14, 1, Math.abs((x - p.ax) / p.rx));
      // Stretch the jaw progressively below the lips. A wide vertical ramp
      // keeps the lip texture from folding over itself during a deep pull.
      const jaw = smooth(h * .68, h * .91, y) * (1 - smooth(h * .92, h * .995, y));
      const weight = chinResponse * across * jaw;
      return { x: clamp(x - p.x * weight, 0, w - 1.001),
        y: clamp(y - p.y * weight * (p.y < 0 ? .32 : 1), 0, h - 1.001) };
    }
    const r2=((x-p.ax-p.x)/p.rx)**2+((y-p.ay-p.y)/p.ry)**2;
    if(r2>=1||y<=h*.49)return {x,y};
    // The center of the face follows the head as one unit. Limit local
    // stretching to the outer cheek and taper it before the nose and lips.
    const eyes = smooth(h * .49, h * .62, y);
    const chin = 1 - smooth(h * .82, h * .88, y);
    const outerCheek = smooth(w * .15, w * .29, Math.abs(x - w * .555));
    const weight = .65 * (1 - r2) ** 3 * eyes * chin * outerCheek;
    return {x:clamp(x-p.x*weight,0,w-1.001),y:clamp(y-p.y*weight,0,h-1.001)};
  }

  function headPull(p, w, h) {
    // Rotate around the neck so the forehead leans toward a sideways pull.
    const response = p.chin ? chinResponse : 1;
    const tilt = response * (Math.PI / 60) * clamp(p.x / (p.rx * .42), -1, 1);
    return {
      centerX: w * .535,
      centerY: h * .43,
      radiusX: w * .45,
      radiusY: h * .425,
      pivotY: h * .78,
      translateX: p.x * .30 * response,
      translateY: p.y * .30 * response,
      cos: Math.cos(tilt),
      sin: Math.sin(tilt),
    };
  }

  function pulledSourcePoint(x, y, p, w, h, head) {
    const local = localSourcePoint(x, y, p, w, h);
    const radiusSquared = ((x - head.centerX) / head.radiusX) ** 2 +
      ((y - head.centerY) / head.radiusY) ** 2;
    const influence = 1 - smooth(.35, 1, radiusSquared);
    const pivotX = head.centerX;
    const offsetX = x - pivotX - head.translateX;
    const offsetY = y - head.pivotY - head.translateY;
    // Inverse rotation samples each output pixel from a valid source pixel.
    const headX = pivotX + offsetX * head.cos + offsetY * head.sin;
    const headY = head.pivotY - offsetX * head.sin + offsetY * head.cos;
    const edge = smooth(w * .025, w * .10, Math.min(x, w - 1 - x)) *
      smooth(h * .025, h * .10, Math.min(y, h - 1 - y));
    const shiftX = (local.x - x + (headX - x) * influence) * edge;
    const shiftY = (local.y - y + (headY - y) * influence) * edge;
    if (shiftX === 0 && shiftY === 0) return { x, y };
    return {
      x: clamp(x + shiftX, 0, w - 1.001),
      y: clamp(y + shiftY, 0, h - 1.001),
    };
  }

  function sourcePoint(x, y, p, w, h) {
    if (!p.followHead) return localSourcePoint(x, y, p, w, h);
    if (p.x === 0 && p.y === 0) return { x, y };
    return pulledSourcePoint(x, y, p, w, h, headPull(p, w, h));
  }
  function spring(p,dt){
    let remaining=Math.min(Math.max(dt,0),.06);
    while(remaining>0){const t=Math.min(remaining,1/120);p.vx+=(-324*p.x-23.4*p.vx)*t;p.vy+=(-324*p.y-23.4*p.vy)*t;p.x+=p.vx*t;p.y+=p.vy*t;remaining-=t;}
    if(Math.hypot(p.x,p.y)<.025&&Math.hypot(p.vx,p.vy)<.15){p.x=p.y=p.vx=p.vy=0;}
    return p;
  }
  function warp(pixels,w,h,p,output){
    const src=pixels.data||pixels,out=output?.data||output||new Uint8ClampedArray(src.length);out.set(src);
    if(p.x===0&&p.y===0)return out;
    const head = p.followHead ? headPull(p, w, h) : null;
    const left = p.ax + p.x - p.rx, right = p.ax + p.x + p.rx;
    const top = p.chin ? h * .68 : p.ay + p.y - p.ry;
    const bottom = p.chin ? h * .995 : p.ay + p.y + p.ry;
    const l = Math.max(0, Math.floor(head ? Math.min(left, head.centerX - head.radiusX) : left));
    const r = Math.min(w, Math.ceil(head ? Math.max(right, head.centerX + head.radiusX) : right));
    const t = Math.max(0, Math.floor(head ? Math.min(top, head.centerY - head.radiusY) : top));
    const b = Math.min(h, Math.ceil(head ? Math.max(bottom, head.centerY + head.radiusY) : bottom));
    for(let y=t;y<b;y++)for(let x=l;x<r;x++){
      const q = head ? pulledSourcePoint(x, y, p, w, h, head) : localSourcePoint(x, y, p, w, h);
      if(q.x===x&&q.y===y)continue;
      const ix=Math.floor(q.x),iy=Math.floor(q.y),fx=q.x-ix,fy=q.y-iy;
      const a=(iy*w+ix)*4,c=a+w*4,o=(y*w+x)*4;
      for(let k=0;k<3;k++)out[o+k]=(src[a+k]*(1-fx)+src[a+4+k]*fx)*(1-fy)+(src[c+k]*(1-fx)+src[c+4+k]*fx)*fy;
    }
    return out;
  }
  return {clamp,limit,sourcePoint,spring,warp};
});
