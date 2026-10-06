// Drawing commands are irrelevant to geometry/collision tests. Texture asset
// contents are verified separately; this deliberately does not claim GPU QA.
export function createHeadlessDocument() {
  const image = () => ({ addEventListener() {}, removeEventListener() {}, set src(value) {} });
  return {
    createElementNS: image,
    createElement: () => {
      const canvas = { width: 0, height: 0 };
      const context = new Proxy({
        canvas,
        measureText: text => ({ width: String(text).length * 12 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createImageData: (width,height) => ({data:new Uint8ClampedArray(width*height*4),width,height}),
        getImageData: (_x,_y,width,height) => ({data:new Uint8ClampedArray(width*height*4),width,height}),
      }, {get:(object,key)=>key in object?object[key]:()=>{}});
      canvas.getContext = () => context;
      return canvas;
    },
  };
}
