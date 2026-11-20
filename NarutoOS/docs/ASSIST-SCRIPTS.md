# 辅助脚本维护

游戏辅助脚本的统一管理与维护说明。范围：应用内随包提供的受信任模块，不含脚本商店、远程下载或第三方脚本执行。

## 总开关

偏好 `assistsEnabled`，默认关闭；旧配置缺失该字段也按关闭处理。保存后提示「重新进入游戏后生效」，即完整退出游戏宿主后重新打开游戏，不重启整个应用。已打开的游戏会话保持原能力，不自动退出或刷新。

所有辅助都经过该开关判定，包括历史达摩、忍术训练活动辅助。开发环境变量（`NARUTO_ACTIVITY_ASSIST`、`NARUTO_DAMO_ASSIST`）只用于隔离测试，不覆盖总开关。汉化开关独立，不受辅助总开关控制。

## 统一管理模块

| 入口 | 职责 |
| --- | --- |
| `assets/assists/manifest.json` | 模块登记：`id`、`nameKey`、`targets`（地区、已验证构建、精确资源 URL、本地文件、补丁摘要、原版摘要、内容类型） |
| `src/main/assist-pack.ts` | 清单读取与校验：摘要、SWF 头、路径越界、凭据 URL、未知版本、重复资源 |
| `src/main/assist-manager.ts` | 资源汇总、冲突拒绝、单桥所有权、模块状态 |
| `src/main/battle-memory-experiment.ts` | 每个 WebContents 一个 debugger，按精确 origin + pathname 替换资源 |
| `scripts/prepare-assist.py` | 从国服原版 SWF 与补丁源码生成资源包 |
| `scripts/check-assist-pack.mjs`、`tests/assist-pack.test.cjs` | 定向检查与清单契约测试 |
| `src/main/resource-probe.ts` | 开发态资源探针：`NARUTO_RESOURCE_PROBE=1` 时记录游戏实际加载的资源 URL，用于国服版本更新后重新定位 SWF；产品默认不启用 |

原版校验分三类证据：本地补丁完整性（运行时校验本地摘要）、目标匹配（精确 URL + 构建标识）、构建指纹（生成时比对原版摘要）。运行时直接返回本地字节，不比对服务器原响应；未知构建、摘要不符或清单冲突时该模块不启用并记录原因，游戏回原版。

## 查克拉批量修炼（国服）

- 模块：`huntlife-batch`，资源 `https://res.huoying.qq.com/NarutoBeta6.38Build302/flash/huntLife/HuntLifePlugin.swf`。
- 原版基准 SHA-256：`95a955264f832b351f7b7e2db3e86c99b49f53d6e9f6811841755a3795bc8eb6`。
- 补丁源码：`flash-patches/huntlife-batch-6.38Build302/com/tencent/morefun/naruto/plugin/huntlife/view/PracticePanel.as`。
- 面板位置：八门修行界面右上角，100 / 500 / 1000 为**轮数**，开始 / 停止 / 进度 / 状态。按钮直接复用游戏原生 `ButtonNormalBlue` 组件（与「一键合成」同一元件、同一套四态皮肤与点击音效），文字由 `LabelButton.drawLayout()` 自动居中；原生组件不可用时回退到自绘渐变按钮。
- 一轮的定义：补满物品格（按实际空位召唤，不写死 20 次）后，一次「一键合成」成功完成即计数 1 轮。
- 执行流程：找当前可操作人物召唤补位 → 物品格满 20 → 一键合成 → 合成产物留在格子里占位，下一轮只补剩余空位 → 继续。轮数达到目标即停止，不额外开启一轮。
- 收纳只在格子内出现满级查克拉（等级 11，`Constants.ChakraMaxLevel`）时执行一次，清出空间后继续；不每轮收纳。
- 协议：`PRACTICE`（213255）、`SELL_CHAKRA`（213256，`type=1`、`mergeFlag=1`）、`PICKUP`（213254）。
- 停止条件：召唤 / 合成 / 收纳返回失败、单步 8 秒超时、30 秒无可用人物、单轮召唤超过 40 次仍未补满（通常是勾选了自动出售灰色导致填不满）、格子已满但无可合成查克拉、面板关闭或移除。重复点击开始不会叠加第二个任务。
- 请求归属：批量发出的召唤 / 合成 / 收纳请求都带 `narutoBatch` 标记，回包只有在标记匹配且处于预期阶段时才推进；手动出售、手动召唤的回包不会被当作批量步骤。
- 停止收尾：停止后仍会消费已发请求的回包并更新模型，不推进轮数，也不依赖手动按钮对象。
- 标签切换：宿主机通过 CDP 调用 Flash 的 `narutoBatchActivity(false)`，切换账号标签或返回启动页时停止批量；切回不自动续跑。
- 运行时原版校验：带 `baseSha256` 的资源在 Response 阶段读取服务器实际响应、按游戏包装解码后比对摘要；不一致或无法读取时放行原响应，不替换。
- 诊断：补丁通过 `ExternalInterface` 输出 `[ASSIST-TRACE]`，宿主写入 `userData/assist-trace.log`，记录召唤次数、物品数、合成与停止原因。

生成与检查：

```sh
python3 scripts/prepare-assist.py --base-swf <原版 HuntLifePlugin.swf> --update-asset
node scripts/check-assist-pack.mjs
node --test tests/assist-pack.test.cjs
```

已知限制：

- 八门背包容量满时收纳会失败，脚本停止并提示「八门背包已满，请先整理」。仅当出现满级查克拉需要收纳时才会遇到。
- 补丁针对国服 `NarutoBeta6.38Build302`（客户端 11.38Build301）。版本更新后需重新取得原版、核对类结构并重新生成，不能跨版本直接沿用。
- 第一版不做品质识别、遇红停止或品质筛选，仍按轮数完成；满级产物走游戏原有收纳流程。

## 国服达摩 / 忍术训练（待适配）

国服资源清单中已确认存在 `flash/operatingActivity/NinjutsuTrain.swf`、`NinjutsuTrain2.swf`、`DaMoTiaoZhanUI.swf`、`YuanDanJiUI.swf` 等活动资源，但活动类型、周期、入口与关键类结构尚未核实，当前未登记 target。

待活动开放并取得实际资源后，按 `docs/ACTIVITY-ASSIST.md` 的补丁流程适配，复用本管理模块、单桥与总开关，不另建加载器。未取得证据前不填写猜测的 URL、构建或活动类型。

## 本轮验证记录

- `pnpm typecheck` 等价检查、开发构建、Swift 原生核心构建通过。
- `node scripts/check-assist-pack.mjs`、`node --test tests/assist-pack.test.cjs`（8 项）通过。
- 补丁 SWF 33 个类与原版一致，仅 `PracticePanel` 变化；内置资源摘要与清单一致。
- 实机：国服八门界面出现批量控制条。第一版按召唤次数计数并每轮收纳，导致测试账号八门背包被填满后在收纳阶段停止；已改为按轮计数、产物留格、仅满级时收纳。新的轮数流程待实机确认。
