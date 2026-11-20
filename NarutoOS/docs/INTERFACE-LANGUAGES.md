# 启动器界面语言

设置 → 外观 → 界面语言，可选简体中文、English、Português (Brasil)。保存成功后，启动中心、打开的游戏工具栏和应用菜单使用所选语言。语言设置不改变地区、账号、当前会话或游戏汉化开关。

三语文案统一维护在 `src/shared/messages.json`；TypeScript 构建时读取该文件，Swift 读取构建复制的 `dist/shared/messages.json`。安装包脚本将同一个文件复制至 `Contents/Resources/app/dist/shared/messages.json`。

`msg(key, params)` 产生保留文案键和参数的字符串，供 IPC、状态和已有提示使用；`resolveText` 在显示时翻译。界面通过 `setText` / `setAttr` 写入并保留语言相关绑定，不重建输入框、账号选项或游戏会话。静态 HTML 使用 `data-i18n` 和 `data-i18n-aria-label` 等属性。参数只写入文本或属性，不写入 HTML。

偏好字段为 `language`。新配置或原始配置缺少字段时，原生侧按 macOS 首选语言顺序匹配主语言：所有中文变体映射为 `zh-CN`，英语映射为 `en`，所有葡语变体映射为 `pt-BR`；支持大小写和 `-` / `_` 分隔符，全部不支持或读取失败时选择中文。已有合法语言值始终保留，已有非法值归一为 `zh-CN`。首次识别发生在默认值补齐之前，由核心通过原有原子保存路径持久化，保存失败不接受请求，后续启动可重新尝试。新写入仅接受 `zh-CN`、`en`、`pt-BR`。Swift 启动早期从数据位置指针及 `management.json` 只读获取语言，字段缺失时复用同一原生匹配规则；配置缺失时也可提前选定系统匹配语言，配置损坏或无法读取时回退中文且不修复配置，资源读取失败时显示最小中文启动错误和可识别的原因键。

缺失翻译回退中文；中文也缺失时显示 `[key]`，开发检查会报告未知键。带数量的启动和运行提示提供单复数模板。

## 验证

先执行 `pnpm prototype:build`，完成后运行：

- `pnpm check:interface-languages`：三语键、空文案、占位符与资源路径检查。
- `pnpm test:interface-languages`：语言逻辑、隔离核心、Swift 早期错误、WK 启动中心、Electron 工具栏和现有游戏窗口同步检查。使用 `.test-artifacts/native-core-i18n-*` 内的合成账号和隔离配置。

专项测试通过仅在隔离 fixture 模式可用的 `NARUTO_C_PREFERRED_LANGUAGES` JSON 列表注入语言，覆盖首次识别、旧选择优先、损坏/不可读配置、真实写盘失败及重新尝试。首次页面由原生初始快照提供语言，页面和工具栏在应用初始状态后显示文案。

截图及详细结果保存在该次隔离目录。开发构建不生成或替换安装应用；安装版仍需在明确授权打包后确认。

## 回退

撤销本次界面语言源代码差异后重新开发构建即可恢复旧界面。保留用户的 `management.json`、数据位置指针、账号目录、钥匙串及其他设置；无需替换用户配置或迁移账号。旧版本忽略新增语言字段。
