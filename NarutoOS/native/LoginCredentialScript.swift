import Foundation

enum LoginCredentialScript {
    static func source(strings: [String: String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: strings)) ?? Data("{}".utf8)
        let localized = String(data: data, encoding: .utf8) ?? "{}"
        return #"""
        (()=>{
          const allowed=location.protocol==='https:'&&['naruto.narutowebgame.com','naruto.oasgames.com'].includes(location.hostname)&&/^\/pt\/serverlist(?:\/s\d{1,6})?\/?$/.test(location.pathname);
          const fixture=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&/^\/pt\/serverlist(?:\/s\d{1,6})?\/?$/.test(location.pathname);
          if((!allowed&&!fixture)||window.top!==window)return;
          let strings=__NARUTO_I18N__;
          const copy=key=>strings[key]||key;
          function note(key){const el=document.createElement('div');el.className='note';el.dataset.copy=key;el.textContent=copy(key);return el;}
          function bind(el,key,attribute){el.setAttribute(attribute?'data-copy-aria':'data-copy',key);if(attribute)el.setAttribute(attribute,copy(key));else el.textContent=copy(key);}
          window.__narutoSetLanguage=value=>{strings=value;for(const el of shadow.querySelectorAll('[data-copy]'))el.textContent=copy(el.dataset.copy);for(const el of shadow.querySelectorAll('[data-copy-aria]'))el.setAttribute('aria-label',copy(el.dataset.copyAria));};
          let request=0,currentPair=null,passwordField=null,filledPassword='',timer;
          const root=document.createElement('div');root.style.cssText='all:initial;position:fixed;z-index:2147483647;display:none;';const shadow=root.attachShadow({mode:'closed'});
          const style=document.createElement('style');style.textContent=`
            :host{all:initial;color-scheme:light dark;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#403832}
            *{box-sizing:border-box}
            button{font:inherit;cursor:pointer}
            .trigger{height:32px;display:inline-flex;align-items:center;gap:8px;padding:0 11px;border:1px solid #ddc9a3;border-radius:9px;background:#fffaf0;color:#654b32;box-shadow:0 2px 7px #4d31151c;transition:background-color 150ms,border-color 150ms,box-shadow 150ms}
            .trigger:hover{background:#fff2d9;border-color:#c88945;box-shadow:0 3px 10px #4d311525}
            .trigger:focus-visible,.item:focus-visible{outline:2px solid #a94c36;outline-offset:2px}
            .trigger-icon{width:16px;height:16px;color:#a64d36;flex:none}
            .trigger-label{font-weight:600;letter-spacing:.01em;white-space:nowrap}
            .chevron{width:12px;height:12px;color:#9b7852;transition:transform 150ms}
            .trigger[aria-expanded=true] .chevron{transform:rotate(180deg)}
            .box{width:264px;margin-top:7px;padding:7px;border:1px solid #e4d5bc;border-radius:12px;background:#fffaf1;color:#403832;box-shadow:0 10px 28px #3927162b,0 1px 3px #39271612;overflow:hidden}
            .box[hidden]{display:none}
            .heading{display:flex;align-items:center;justify-content:space-between;padding:7px 8px 9px}
            .eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;color:#9b563b}
            .scope{font-size:10px;color:#897b68}
            .body{max-height:212px;overflow:auto}
            .item{width:100%;min-height:44px;display:flex;align-items:center;gap:10px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;transition:background-color 140ms}
            .item:hover,.item:focus-visible{background:#f7eddc}
            .avatar{width:29px;height:29px;display:grid;place-items:center;flex:none;border:1px solid #ead8b9;border-radius:8px;background:#f5e8d2;color:#9a4c35;font-size:12px;font-weight:700}
            .identity{min-width:0;display:block;flex:1}
            .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:#403832}
            .arrow{width:14px;height:14px;flex:none;color:#ad8050}
            .note{padding:12px 9px 13px;color:#746858;font-size:11px;line-height:1.5}
            @media(prefers-color-scheme:dark){
              :host{color:#eee5d8}
              .trigger{border-color:#5b4a38;background:#302b25;color:#eadcc5;box-shadow:0 2px 8px #0004}
              .trigger:hover{background:#3a3027;border-color:#a87042}
              .trigger-icon{color:#df9c72}.chevron{color:#c1a17b}
              .box{border-color:#514538;background:#292621;color:#eee5d8;box-shadow:0 12px 30px #0008}
              .eyebrow{color:#dfa07e}.scope,.note{color:#b8aa96}
              .item:hover,.item:focus-visible{background:#393229}
              .avatar{border-color:#594737;background:#3a3027;color:#e3a17e}
              .name{color:#eee5d8}.arrow{color:#d1a06d}
            }
            @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}
          `;
          const button=document.createElement('button');button.type='button';button.className='trigger';bind(button,'password.trigger','aria-label');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.innerHTML='<svg class="trigger-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="m9.4 10.4 6.1 6.1m-2.2-2.2 1.8-1.8m-3.4.2 1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span class="trigger-label" data-copy="password.trigger"></span><svg class="chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          bind(button.querySelector('.trigger-label'),'password.trigger');
          const box=document.createElement('div');box.className='box';box.hidden=true;box.setAttribute('role','group');bind(box,'password.siteAccounts','aria-label');
          const heading=document.createElement('div');heading.className='heading';heading.innerHTML='<span class="eyebrow">NARUTO OS</span><span class="scope" data-copy="password.currentSite"></span>';
          bind(heading.querySelector('.scope'),'password.currentSite');
          const body=document.createElement('div');body.className='body';body.setAttribute('role','listbox');bind(body,'password.savedAccounts','aria-label');box.append(heading,body);shadow.append(style,button,box);document.documentElement.append(root);
          function visible(input){const r=input.getBoundingClientRect(),s=getComputedStyle(input);return r.width>=36&&r.height>=18&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
          function pairFor(target){const pass=Array.from(document.querySelectorAll('input[type=password]')).find(x=>visible(x)&&!x.disabled&&!x.readOnly&&x.autocomplete!=='new-password');if(!pass)return null;const scope=pass.form||pass.closest('.login,.login_box,.loginbox,[role=dialog]')||document;const fields=Array.from(scope.querySelectorAll('input')).filter(x=>x!==pass&&visible(x)&&!x.disabled&&!x.readOnly&&['text','email','tel',''].includes(x.type));const user=fields.find(x=>/username|email|account|login|user|conta/i.test(x.name+' '+x.id+' '+x.autocomplete))||fields[0];return user&&(!target||target===user||target===pass)?{user,pass}:null;}
          function hide(){request++;if(body.childElementCount)body.replaceChildren();if(!box.hidden)box.hidden=true;if(button.getAttribute('aria-expanded')!=='false')button.setAttribute('aria-expanded','false');}
          function place(){const pair=pairFor();if(!pair){currentPair=null;hide();root.style.display='none';return;}currentPair=pair;root.style.display='block';const r=pair.user.getBoundingClientRect(),end=pair.pass.getBoundingClientRect();root.style.left=Math.max(12,Math.min(r.left,innerWidth-280))+'px';root.style.top=Math.max(12,Math.min(end.bottom+5,innerHeight-280))+'px';}
          function query(){const pair=pairFor();if(!pair){place();return;}currentPair=pair;place();const id='p'+(++request);box.hidden=false;button.setAttribute('aria-expanded','true');body.replaceChildren(note('password.reading'));window.webkit.messageHandlers.narutoCredentials.postMessage({type:'query',requestId:id,query:pair.user.value});}
          window.__narutoCredentialResponse=data=>{if(!data||data.requestId!=='p'+request)return;body.replaceChildren();if(data.errorKey){body.append(note(data.errorKey));return;}if(!data.accounts.length){body.append(note(data.query?'password.noMatchShort':'password.noneSite'));return;}for(const item of data.accounts){const row=document.createElement('button');row.type='button';row.className='item';row.setAttribute('role','option');const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=(item.username.trim()[0]||'·').toLocaleUpperCase();const identity=document.createElement('span');identity.className='identity';const name=document.createElement('span');name.className='name';name.textContent=item.username;identity.append(name);const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 16 16');arrow.setAttribute('fill','none');arrow.setAttribute('aria-hidden','true');arrow.classList.add('arrow');arrow.innerHTML='<path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';row.append(avatar,identity,arrow);row.addEventListener('click',()=>{if(currentPair&&currentPair.user.isConnected&&currentPair.pass.isConnected)window.webkit.messageHandlers.narutoCredentials.postMessage({type:'select',requestId:data.requestId,id:item.id});});body.append(row);}};
          function canTrigger(pair){return /^[A-Za-z0-9]/.test(pair.user.value.trim());}button.addEventListener('click',e=>{if(e.isTrusted)query();});document.addEventListener('focusin',e=>{if(!e.isTrusted)return;const pair=pairFor(e.target);if(!pair)return;currentPair=pair;place();if(e.target===pair.pass)hide();},true);document.addEventListener('input',e=>{if(!e.isTrusted||!currentPair)return;if(e.target===currentPair.pass){hide();return;}if(e.target===currentPair.user){clearTimeout(timer);if(canTrigger(currentPair))timer=setTimeout(query,120);else hide();}},true);document.addEventListener('click',e=>{if(e.isTrusted&&!root.contains(e.target)&&!shadow.contains(e.target))hide();},true);
          place();new MutationObserver(records=>{if(records.some(record=>!root.contains(record.target)))place();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});window.addEventListener('resize',place,true);window.addEventListener('scroll',place,true);
          window.__narutoClearCredentialState=()=>{hide();if(passwordField&&passwordField.isConnected&&passwordField.value===filledPassword){passwordField.value='';passwordField.dispatchEvent(new Event('input',{bubbles:true}));}passwordField=null;filledPassword='';};
          window.__narutoCredentialFill=data=>{if(!data||data.requestId!=='p'+request||!currentPair||!currentPair.user.isConnected||!currentPair.pass.isConnected)return;if(data.errorKey){box.hidden=false;body.replaceChildren(note(data.errorKey));return;}const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};set(currentPair.user,data.username);set(currentPair.pass,data.password);passwordField=currentPair.pass;filledPassword=data.password;hide();};
        })();
        """#.replacingOccurrences(of: "__NARUTO_I18N__", with: localized)
    }
}
