void (async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause(50)}throw Error('UI condition timeout')}
 const result={};
 try{
  await until(()=>window.naruto&&document.getElementById('lobby-current')&&!document.getElementById('lobby-current').disabled);
  result.art=!!document.getElementById('lobby-character').naturalWidth;
  await pause(800);
  result.canvasError=document.getElementById('lobby').dataset.canvasError||null;
  result.canvasPixels=['lobby-dots','lobby-lines'].map(id=>{const c=document.getElementById(id);const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<data.length;i+=4)if(data[i])count++;return count});
  result.background=result.canvasError===null&&result.canvasPixels.every(n=>n>100);
  if(!result.background)throw Error('主页网点／放射线未绘制：'+JSON.stringify({error:result.canvasError,pixels:result.canvasPixels}));
  document.getElementById('settings').click();await until(()=>!document.getElementById('settings-panel').hidden);
  result.settings=true;result.profiles=document.querySelectorAll('#profile-list .profile-row').length;
  if(document.getElementById('center-auto-close').getAttribute('aria-checked')==='true'){document.getElementById('center-auto-close').click();await until(()=>document.getElementById('center-auto-close').getAttribute('aria-checked')==='false')}
  document.getElementById('close-settings').click();await until(()=>document.getElementById('settings-panel').hidden);
  document.getElementById('lobby-current').click();await until(()=>!document.getElementById('profile-deck').hidden);
  const capsuleY=document.querySelector('.lobby-capsule').getBoundingClientRect().top;
  const first=document.querySelector('#profile-deck .lobby-option');if(first.getAttribute('aria-selected')==='true')first.click();document.querySelector('#profile-deck .lobby-option').click();await until(()=>document.getElementById('open-game').getAttribute('aria-label').includes('1 个账号'));
  result.dockStable=Math.abs(document.querySelector('.lobby-capsule').getBoundingClientRect().top-capsuleY)<1;
  document.getElementById('open-game').click();await pause(1000);await until(()=>!document.getElementById('open-game').disabled);
  result.firstBatch=true;
  document.getElementById('lobby-region').click();await until(()=>document.getElementById('lobby-region-label').textContent==='国服');
  document.getElementById('lobby-current').click();await until(()=>!document.getElementById('profile-deck').hidden);
  document.querySelector('#profile-deck .lobby-option').click();await until(()=>document.getElementById('open-game').getAttribute('aria-label').includes('2 个账号'));
  document.getElementById('open-game').click();await pause(1000);await until(()=>!document.getElementById('open-game').disabled);
  result.secondBatch=true;result.crossRegionSelection=document.getElementById('selection-summary').textContent.includes('巴西服')&&document.getElementById('selection-summary').textContent.includes('国服');
  if(!document.getElementById('profile-deck').hidden)document.getElementById('lobby-current').click();
  await pause(350);
  await pause(100);
  result.quiet=document.querySelectorAll('[title]').length===0&&['selection-summary','runtime-summary'].every(id=>getComputedStyle(document.getElementById(id)).display==='none');
  result.ok=result.quiet&&result.dockStable&&result.background&&result.art&&result.settings&&result.profiles>=2&&result.firstBatch&&result.secondBatch&&result.crossRegionSelection;
 }catch(error){result.error=String(error);result.ok=false}
 window.__uiTestOutcome=result;
})();
