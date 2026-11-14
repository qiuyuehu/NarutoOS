// One physical target and a single click, after the page can handle it.
(async()=>{
  const button=document.getElementById('open-game');
  for(let i=0;i<100 && button.disabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
  const r=button.getBoundingClientRect();
  if(button.disabled || !button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('Launch button is obscured');
  button.click();
})()
