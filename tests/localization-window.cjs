const { app } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert'), { createHash } = require('crypto');
const { createLocalizationExperiment, createGameLocalization } = require('../.test-artifacts/localization-test/factory.cjs');
const root = fs.mkdtempSync(path.join(path.resolve(__dirname, '../.test-artifacts'), 'localization-check-'));
app.setPath('userData', path.join(root, '.test-artifacts/profile'));
const pack = path.join(root, '.test-artifacts/localization-2026-11-03/pack');
fs.mkdirSync(pack, { recursive: true });
const bytes = Buffer.from('CWS-test-only');
const cfgBytes = Buffer.from([0x78, 0x9c, 0x00]);
const crewBytes = Buffer.from('CWS-crew-test');
const infoBytes = Buffer.from('CWS-info-test');
const roleProfileBytes = Buffer.from('CWS-role-profile-test');
const taskTrackBytes = Buffer.from('CWS-task-track-test');
const taskDetailBytes = Buffer.from('CWS-task-detail-test');
const dailyTrainingBytes = Buffer.from('CWS-daily-training-test');
const aiManageBytes = Buffer.from('CWS-ai-manage-test');
const equipmentBytes = Buffer.from('CWS-equipment-test');
const resourceOverrides = [
  { id: 'naruto-translated-key-cfg-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.33Build300/config/i18n/TranslatedKeyCFG.cfg', file: 'TranslatedKeyCFG.zh-CN.cfg', contentType: 'application/octet-stream', patchedSha256: createHash('sha256').update(cfgBytes).digest('hex') },
  { id: 'naruto-crew-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.18Build300/flash/crew/CrewUI.swf', file: 'CrewUI.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(crewBytes).digest('hex') },
  { id: 'naruto-info-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.13Build300/flash/crew/infoUI.swf', file: 'infoUI.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(infoBytes).digest('hex') },
  { id: 'naruto-role-profile-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.43Build300/flash/crew/roleProfileUI.swf', file: 'roleProfileUI.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(roleProfileBytes).digest('hex') },
  { id: 'naruto-task-track-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.TrackPanel.swf', file: 'TrackPanel.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(taskTrackBytes).digest('hex') },
  { id: 'naruto-task-detail-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.swf', file: 'ui.task.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(taskDetailBytes).digest('hex') },
  { id: 'naruto-daily-training-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/hud/activityDashboard.swf', file: 'activityDashboard.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(dailyTrainingBytes).digest('hex') },
  { id: 'naruto-ai-manage-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.39Build301/flash/ai/AIManageUI.swf', file: 'AIManageUI.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(aiManageBytes).digest('hex') },
  { id: 'naruto-equipment-ui-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.10Build300/flash/equipment/EquipmentUI.swf', file: 'EquipmentUI.zh-CN.swf', contentType: 'application/x-shockwave-flash', patchedSha256: createHash('sha256').update(equipmentBytes).digest('hex') },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-archive', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/archives/item1.pkg', file: 'item1.madara-zh-CN.pkg', contentType: 'application/octet-stream', patchedSha256: createHash('sha256').update(cfgBytes).digest('hex') },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-skill-details', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/skill/SkillKeyDescCFG.cfg', file: 'SkillKeyDescCFG.madara-zh-CN.cfg', contentType: 'application/octet-stream', patchedSha256: createHash('sha256').update(cfgBytes).digest('hex') }
];
const manifest = { id: 'naruto-hud-zh-CN-v1', resourceURL: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.19Build301/flash/hud/mainUI.swf', patchedSha256: createHash('sha256').update(bytes).digest('hex'), resourceOverrides };
const writePack = value => {
  fs.writeFileSync(path.join(pack, 'manifest.json'), JSON.stringify(value));
  fs.writeFileSync(path.join(pack, 'mainUI.zh-CN.swf'), bytes);
  fs.writeFileSync(path.join(pack, 'TranslatedKeyCFG.zh-CN.cfg'), cfgBytes);
  fs.writeFileSync(path.join(pack, 'CrewUI.zh-CN.swf'), crewBytes);
  fs.writeFileSync(path.join(pack, 'infoUI.zh-CN.swf'), infoBytes);
  fs.writeFileSync(path.join(pack, 'roleProfileUI.zh-CN.swf'), roleProfileBytes);
  fs.writeFileSync(path.join(pack, 'TrackPanel.zh-CN.swf'), taskTrackBytes);
  fs.writeFileSync(path.join(pack, 'ui.task.zh-CN.swf'), taskDetailBytes);
  fs.writeFileSync(path.join(pack, 'activityDashboard.zh-CN.swf'), dailyTrainingBytes);
  fs.writeFileSync(path.join(pack, 'AIManageUI.zh-CN.swf'), aiManageBytes);
  fs.writeFileSync(path.join(pack, 'EquipmentUI.zh-CN.swf'), equipmentBytes);
  fs.writeFileSync(path.join(pack, 'SkillKeyDescCFG.madara-zh-CN.cfg'), cfgBytes);
  fs.writeFileSync(path.join(pack, 'item1.madara-zh-CN.pkg'), cfgBytes);
};
const results = [];
const check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
app.whenReady().then(() => {
  try {
    delete process.env.NARUTO_LOCALIZATION_EXPERIMENT;
    delete process.env.NARUTO_BATTLE_MEMORY_EXPERIMENT;
    delete process.env.NARUTO_LOCALIZATION_ORIGINAL;
    check('ordinary application creates no localization bridge or reads pack', createLocalizationExperiment(root, () => {}) === undefined);
    process.env.NARUTO_LOCALIZATION_EXPERIMENT = '1';
    check('missing pack falls back to an isolated observation bridge', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack(manifest);
    check('matching pack enables exact-version replacement', !createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceURL: manifest.resourceURL.replace('9.19', '9.20') });
    check('different resource version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceOverrides: manifest.resourceOverrides.map(item => item.id === 'naruto-crew-ui-zh-CN-v1' ? { ...item, resourceURL: item.resourceURL.replace('9.18', '9.19') } : item) });
    check('different CrewUI version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceOverrides: manifest.resourceOverrides.map(item => item.id === 'naruto-role-profile-ui-zh-CN-v1' ? { ...item, resourceURL: item.resourceURL.replace('8.43', '8.44') } : item) });
    check('different role profile version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceOverrides: manifest.resourceOverrides.map(item => item.id === 'naruto-task-track-ui-zh-CN-v1' ? { ...item, resourceURL: item.resourceURL.replace('6.93', '6.94') } : item) });
    check('different task tracker version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceOverrides: manifest.resourceOverrides.map(item => item.id === 'naruto-task-detail-ui-zh-CN-v1' ? { ...item, resourceURL: item.resourceURL.replace('6.93', '6.94') } : item) });
    check('different task detail version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack({ ...manifest, resourceOverrides: manifest.resourceOverrides.map(item => item.id === 'naruto-daily-training-zh-CN-v1' ? { ...item, resourceURL: item.resourceURL.replace('6.93', '6.94') } : item) });
    check('different Daily Training version falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    writePack(manifest);
    fs.appendFileSync(path.join(pack, 'mainUI.zh-CN.swf'), 'changed');
    check('corrupt bytes fall back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    fs.writeFileSync(path.join(pack, 'manifest.json'), '{');
    check('malformed manifest falls back to original', createLocalizationExperiment(root, () => {}).observeOnly);
    // Normal mode uses the bundled pack and must never require an experiment profile.
    writePack(manifest);
    const productionPack = path.join(root, 'assets/localization/pack');
    fs.mkdirSync(path.dirname(productionPack), { recursive: true });
    fs.mkdirSync(productionPack, { recursive: true });
    for (const file of fs.readdirSync(pack)) fs.copyFileSync(path.join(pack, file), path.join(productionPack, file));
    app.setPath('userData', path.join(root, 'regular-profile'));
    check('disabled production localization reads no pack', createGameLocalization(root, false, () => {}) === undefined);
    check('production localization loads with ordinary user data', !createGameLocalization(root, true, () => {}).observeOnly);
    fs.appendFileSync(path.join(productionPack, 'item1.madara-zh-CN.pkg'), 'corrupt');
    check('corrupt production pack falls back without preventing startup', createGameLocalization(root, true, () => {}) === undefined);
    app.setPath('userData', path.join(root, '.test-artifacts/profile'));
    process.env.NARUTO_LOCALIZATION_ORIGINAL = '1';
    check('original control needs no usable localization pack', createLocalizationExperiment(root, () => {}).observeOnly);
    process.env.NARUTO_BATTLE_MEMORY_EXPERIMENT = '1';
    assert.throws(() => createLocalizationExperiment(root, () => {}), /单独启动/);
    check('memory and localization experiments are mutually exclusive', true);
    delete process.env.NARUTO_BATTLE_MEMORY_EXPERIMENT;
    app.setPath('userData', root);
    assert.throws(() => createLocalizationExperiment(root, () => {}), /隔离/);
    check('non-isolated user data is rejected', true);
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
    app.quit();
  } catch (error) { console.error(error); app.exit(1); }
});
