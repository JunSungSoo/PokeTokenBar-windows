// Same alpha-bound square crop as Mac SpriteLoader.cropToContent; original PNG stays intact.
(() => {
  const images = new WeakSet();
  function crop(image) {
    if (!image.isConnected || !image.naturalWidth || image.parentElement.querySelector('.egg-canvas')) return;
    const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0);
    const {data}=context.getImageData(0,0,canvas.width,canvas.height);
    let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]>2.55){ minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
    if(maxX<minX)return;
    const side=Math.max(maxX-minX+1,maxY-minY+1),width=Math.min(side,canvas.width),height=Math.min(side,canvas.height);
    const x=Math.max(0,Math.min(Math.floor(minX-(width-(maxX-minX+1))/2),canvas.width-width));
    const y=Math.max(0,Math.min(Math.floor(minY-(height-(maxY-minY+1))/2),canvas.height-height));
    const output=document.createElement('canvas');output.width=width;output.height=height;output.className='sprite-canvas egg-canvas';output.setAttribute('aria-hidden','true');
    output.getContext('2d').drawImage(canvas,x,y,width,height,0,0,width,height);image.after(output);image.classList.add('sprite-decoded');
  }
  function scan(){for(const image of document.querySelectorAll('.egg-art img'))if(!images.has(image)){images.add(image);image.addEventListener('load',()=>crop(image));if(image.complete)crop(image);}}
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});scan();
})();
