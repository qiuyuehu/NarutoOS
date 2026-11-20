# 活动辅助维护

统一资源：`assets/activity-assist-9.40Build300/OperatingActivityPlugin.activity-assist.swf`，清单与 SWF 一起使用。当前包含达摩原有功能、忍术训练旧版 800223 与新版 800264 的“完成当前一组结印”。

## 使用行为

手动打开活动并开始训练，点击一次辅助完成当前组剩余结印。正常播放动画，下一组出现后再点击。每天三组最多点击三次，奖励手动领取。动画、失败、页面隐藏或关闭期间辅助不执行。

## 修改与生成

- 在 `flash-patches/activity-assist.json` 登记每个活动的补丁目录及精确文件清单。各活动源码独立存放，生成时合并导入同一原版插件。不得修改共用分发类来强行识别活动。
- 先核对当前游戏实际配置或缓存中的资源 URL，再确认官方资源版本和解码后的基准摘要；脚本支持标准 SWF 和游戏包装格式。未知基准会拒绝生成。活动类型或代码变化时手动适配，不自动跨版本替换。
- 生成命令：`python3 scripts/prepare-activity-assist.py --base-swf <原版资源路径> --update-asset`。输出开发资源及内置资源，不打包应用。旧 `prepare-damo-assist.py` 和 `--package-asset` 参数会转交此入口。
- 定向检查：`node scripts/check-activity-assist.mjs`、`node --test tests/activity-assist.test.cjs`、`pnpm typecheck`。
- FFDec 重新导出后，可用 `ACTIVITY_ASSIST_EXPORTED=1 node --test tests/activity-assist.test.cjs` 对导出代码补验。该模式需要本地 `.test-artifacts/activity-assist-9.40Build300/patched-export/scripts/`。

开发使用 `NARUTO_ACTIVITY_ASSIST=1`，兼容 `NARUTO_DAMO_ASSIST=1`；数据目录必须在项目 `.test-artifacts/` 内。开发资源需要先生成。安装版从内置资源读取；资源损坏时回到原版活动。汉化关闭时使用独立资源桥，开启时与汉化共用桥。

## 验证边界

单元检查执行实际 AS3 类经语法转换后的控制流，显示对象和协议使用替身；FFDec 编译及重新导出另行检查。它们不验证真实 Flash 布局、帧调度或服务器回包。真实活动应检查：按钮位置、手动部分结印后接续、动画中连点、三组正常结算、关闭重开与每日奖励状态。达摩真实交互在活动开放时验收。

本轮方案、验收状态见 [执行方案](plans/2026-11-15/01-activity-assist.md)。旧达摩资源保留作回退依据，运行入口只加载统一资源。

## 庆典大转盘汉化

忍术结印辅助已由用户在多个账号实机确认可用。

活动汉化与辅助共用固定版本插件 URL。汉化开启时读取 `OperatingActivityPlugin.activity-assist.zh-CN.swf`，关闭时读取原辅助文件；两个文件的摘要分别记录在同一 manifest 中。汉化版保留达摩与忍术辅助，仅额外修改庆典大转盘（类型810020）的三个显示类。

翻译源为 `localization/celebration-turntable.zh-CN.json`。先执行 `python3 scripts/prepare-celebration-localization.py` 从已验证的9.40原版导出生成显示补丁，再执行统一生成器生成两个变体。任务描述仅处理已知五类，未知描述保持原文；标题图片和左侧活动名称保留。验收记录见 [庆典汉化方案](plans/2026-11-15/02-celebration-localization.md)。
