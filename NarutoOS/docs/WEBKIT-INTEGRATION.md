# 现代登录正式接入 · 2026-10-21

授权：用户已验收独立原型登录、进入游戏均成功，并要求开始接入，已退出游戏，允许本次打包安装更新。范围为巴西服现代登录与现有主页/标签/登录保存衔接，国服沿用原流程；不改代理、不读取 Safari、不提交或分发源码。

实现：保留已经验收的 WK 外壳适配和 HTTPS 游戏入口限制。点击巴西服开始游戏时先预留一个现有持久分区，钥匙串恢复完成后通过匿名父子管道把该分区的 Cookie 提供给隔离 WK。选区成功后先同步 Cookie，再用同一预留分区创建 Flash 游戏标签。关闭登录窗、退出启动器时同步 Cookie、释放分区和进程。重复点击聚焦当前登录窗口。只在点击时启动 helper；启动首页保持零游戏窗口、零登录进程。

保存：复用原有 LoginSessions 和钥匙串，不新增明文会话文件。WK 为每次启动独立的 nonPersistent 数据仓库；只从本启动器分区导入允许的巴西服 Cookie。保留 hostOnly/domain/path/Secure/HttpOnly/SameSite/expiry/session。完整快照同步删除的 Cookie，支持退出账号。国服、同时运行的独立账号分区互不覆盖。

检查：真实原型已获用户验收；新增正式协调器+实际 WK 的合成测试覆盖首请求种子、外壳 iframe 交接、关闭未选区时保存、再次打开恢复、取消/退出竞态、分区释放、多标签隔离。运行类型检查、现有模块/会话测试及实际打包应用测试，独立复核后安装。正式版真实账号登录和体验保留用户验收。

发布：版本 0.1.11，本地新目录打包、验签及隔离检查后替换 /Applications/Naruto OS.app；旧安装移入废纸篓保留可恢复副本，不覆盖用户数据。失败则保留当前安装并报告；正式修改只作用本任务相关位置，保留所有既有无关改动。

实现及独立复核完成。`pnpm verify` 类型/构建/17模块通过；`test:sessions` 原双地区30项通过；原型wrapper25项通过。正式协调器跨两真实Electron进程、实际WK测试40项通过（`.test-artifacts/web-login-n3HZ8K/`），覆盖关闭未选区保存、跨进程恢复两个账号、完整属性往返、删除、同步失败回滚、崩溃保留旧状态、恢复未完成时退出。Luna 独立复核未发现阻断，未替代主Agent运行测试或用户真实验收。

实现细节：Cookie identity 按 Chromium 的 name/domain/path（域规范化去前导点）识别，hostOnly 是需保留的属性。只删除本次种子中终态缺失的项，其他域及非种子内容保留。接入时发现 Foundation Secure 属性键只要存在即为 true，已改为 false 时省略；普通 false 与 Secure+HttpOnly+SameSite=None 往返均有回归。WK 是登录交接阶段的状态源，成功后退出；游戏后续 Cookie 由原 Electron Session 监听保存。

最终签名包：`release/builds.noindex/NarutoOS-0.1.11-local-L4xaOa/Naruto OS.app`；66 项实际应用检查通过（`.test-artifacts/package-check-MCnxku/`），使用包内已签名 helper 的40项现代登录检查通过（`.test-artifacts/web-login-n1U2U6/`）。

已安装 `/Applications/Naruto OS.app`，版本0.1.11；深度签名及19项关键文件与签名构建一致。旧0.1.10保留在 `/Users/youye/.Trash/Naruto OS 0.1.10 replaced-8f56130b09.app`。实机冷启动已通过CUA确认只显示巴西服主页，无游戏标签，原生登录进程为0。交付记录在 `release/delivery.json`。未提交、上传或公开发布。

状态：接入、检查、安装完成；正式版真实账号登录、选区和退出重开后的登录保留待用户体验验收。之前原型真实登录和进入游戏已获用户确认。
