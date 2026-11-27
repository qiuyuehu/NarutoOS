import { app, Menu, type BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { msg, resolveText } from '../../shared/i18n';
import { measureTrafficLights } from '../../main/traffic-lights';
import type { GameSessions } from '../../main/game';
import type { WebLogin } from '../../main/web-login';
import type { createShutdown } from './shutdown';
import type { Task } from './task-queue';
import type { toolbarTabs } from './toolbar-state';

type HostFixtureInputs = {
  root: string;
  instance: string;
  win: BrowserWindow;
  games: Pick<GameSessions, 'active' | 'tabs'>;
  tasks: ReadonlyMap<string, Task>;
  hostShutdown: Pick<ReturnType<typeof createShutdown>, 'state' | 'shutdown'>;
  loginFixture: boolean;
  loginPages: ReadonlyMap<string, Pick<WebLogin, 'loginViewVisible'>>;
  visibleTabs: () => ReturnType<typeof toolbarTabs>;
  openCenter: () => Promise<void>;
};

export function startHostFixture({
  root, instance, win, games, tasks, hostShutdown, loginFixture, loginPages, visibleTabs, openCenter,
}: HostFixtureInputs) {
  setInterval(async () => {
    const status: any = { appName:app.getName(), packaged:app.isPackaged, executable:app.getPath('exe'), pid: process.pid, instance, exitState: hostShutdown.state, sessionMarkers: {}, tasks: Array.from(tasks.values()).map(t => ({ operationId: t.operationId, profileId: t.profileId, status: t.status })), ticks: {}, quality: {}, activeProfile: games.active?.profileId || null, window: { trafficLights: measureTrafficLights(win), bounds: win.getBounds(), contentBounds: win.getContentBounds(), settingsMenu: !!Menu.getApplicationMenu()?.items[0]?.submenu?.items.some(item => item.label === resolveText(msg('ui.settings'))) } };
    if(process.env.NARUTO_C_UI_CHECKS==='i18n')status.interface=await win.webContents.executeJavaScript("({language:document.documentElement.lang,settings:document.getElementById('settings').getAttribute('aria-label'),text:document.body.innerText})");
    if(loginFixture){
      status.loginTabs=visibleTabs().map(t=>({profile:t.profileId,active:t.active,visible:loginPages.get(t.id)?.loginViewVisible,status:t.status}));
      status.notice=await win.webContents.executeJavaScript("document.getElementById('notice').textContent");
      if(fs.existsSync(path.join(root,'fixture-mute'))){fs.unlinkSync(path.join(root,'fixture-mute'));await win.webContents.executeJavaScript("document.getElementById('mute').click()");}
    }
    const cookieFile=path.join(root,'fixture-session-cookie');
    const cookieTab=games.tabs.find(tab=>tab.profileId==='br-1')||games.active;
    if(fs.existsSync(cookieFile)&&cookieTab){
      fs.unlinkSync(cookieFile);await cookieTab.profile!.session.cookies.set({url:'https://fixture.invalid',name:'exit-retry',value:'synthetic-exit-retry',httpOnly:true});
    }
    for (const tab of games.tabs) try {
      status.sessionMarkers[tab.profileId!]=(await tab.profile!.session.cookies.get({url:'https://fixture.invalid',name:'exit-retry'}))[0]?.value||null;
      status.ticks[tab.profileId!] = await tab.view.webContents.executeJavaScript('Number(document.getElementById("ticks")?.textContent || 0)');
      status.quality[tab.profileId!] = await tab.view.webContents.executeJavaScript('document.getElementById("flash")?.readQuality?.() ?? null');
    } catch { /* A fixture tab may have just closed. */ }
    status.toolbar=await win.webContents.executeJavaScript('({tabCount:document.querySelectorAll(".tab").length,retryExitVisible:!document.getElementById("retry-exit").hidden&&!document.getElementById("retry-exit").disabled})');
    if(fs.existsSync(path.join(root,'fixture-open-center'))){fs.unlinkSync(path.join(root,'fixture-open-center'));await openCenter();}
    const focusFile=path.join(root,'fixture-focus');
    if(fs.existsSync(focusFile)){
      const id=fs.readFileSync(focusFile,'utf8');fs.unlinkSync(focusFile);
      if(/^(br|cn)-[1-9][0-9]*$/.test(id))await win.webContents.executeJavaScript(`document.querySelector('[data-profile-id="${id}"] .tab-select')?.click()`);
    }
    fs.writeFileSync(path.join(root, 'fixture-status.json'), JSON.stringify(status), { mode: 0o600 });
    if (fs.existsSync(path.join(root, 'fixture-stop'))) { fs.unlinkSync(path.join(root,'fixture-stop')); void hostShutdown.shutdown(); }
  }, 500);
}
