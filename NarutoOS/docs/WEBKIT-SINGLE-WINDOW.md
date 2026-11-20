# 单窗口修正

用户指出未授权独立登录窗口，要求保留启动器内的使用体验。修正范围：同一个主窗口容纳现代 WK 登录/选区和 Flash 游戏；保留 Cookie 保存、隔离与原游戏标签。取消正式版独立 helper 窗口，不改变主页设计及代理。

方案：复用已通过真实登录验收的 Swift WK 逻辑，编译为与 Intel Electron 同架构的原生库，通过最小 N-API 适配把 WKWebView 放在现有 NSWindow 内容区域，顶端42px工具栏保留。跨引擎交接仍复用现有白名单、快照校验与账号槽位。Native通过主进程内部回调发事件，网页没有Node桥。主页和其他标签切换取消待登录；设置/对话框暂隐藏该视图。关闭先保存快照再移除view，不替换Electron的窗口delegate、菜单或应用delegate。

验证：先用实际Electron+本机合成站点确认窗口数不增加、WK确实附着主窗口、布局跟随resize/隐藏、登录Cookie首请求恢复、内嵌iframe转Flash标签、取消保存和跨进程恢复；现有Flash渲染及主页回归；独立复核后本地打包安装0.1.12。真实官网环境保留用户验收。若原生加载失败显示错误并保留主页，不回退为弹出独立窗口。

授权沿用本次修正及打包安装范围；保留已安装0.1.11直到新包通过检查，旧安装移入废纸篓恢复。状态：实现前验证中。

实现完成：Swift 同源规则、Cookie 种子/快照逻辑保留，embedded模式编译为x86_64动态库（macOS15+），NAPI适配精确校验主窗口句柄、TSFN回调和env cleanup；不创建独立NSWindow，不改Electron菜单及delegate。登录有原窗口内的待登录标签，主页/关标签/切其他游戏会取消保存，设置和对话框会隐藏视图。取消状态强制保持隐藏，避免广播反向显示。正式包移除了独立Login.app，原生组件为embedded-login.node和libnaruto-login.dylib。

已通过类型/构建/17模块及实际Electron+WK两进程单窗口专项；包括NSApp窗口数量不增加、视图挂载/隐藏/交接移除、Cookie完整属性恢复、取消保存、不同账号、写入失败恢复。Luna独立复核提出的取消隐藏竞态与TSFN失败分支已修正并复核通过。

2026-10-22：已生成并验签0.1.12签名包 `release/builds.noindex/NarutoOS-0.1.12-local-mAXJmV/Naruto OS.app`。实际签名包检查在51项后Flash画面捕获失败，flash-surface.png为空。重试同样失败后，CUA明确报告Mac已锁屏，不能自动解锁；需要用户手动解锁后重跑可视化检查。当前0.1.11安装版保留，尚未替换。不得把单窗口源码检查或无截图专项通过记为Flash画面验收通过。

包内已签名embedded-login.node及dylib的单窗口专项45项通过，报告 `.test-artifacts/web-login-AhM1xY/`。当前唯一待完成门为解锁后的66项可视化/Flash实际签名包检查和实际安装；安装后再由用户体验官网登录。需要解锁的请求已发给用户，未尝试绕过系统锁定。


## 2026-10-22 0.1.12 已安装与 0.1.13 后续修复

用户解锁后，0.1.12签名包66项（含真实Flash渲染）通过，报告 `.test-artifacts/package-check-LhHXB5/`，随后安装并逐文件验签。正式官网访问出现403；同一时段独立WK及Safari也显示Cloudflare403。用户随后指出关闭代理后可到登录页，但登录后回启动页，并明确要求启动器单独直连。该真实登录交接故障仍需安装版验证，不能将网络对照视作其根因已经确定。

0.1.13：内嵌WK通过公开WebsiteDataStore proxyConfigurations覆盖本数据存储代理，仅保留 `.invalid` 域匹配，真实网站直连；Electron游戏会话首请求前设DIRECT。不改系统代理及Clash。系统代理开启时，隔离WK对照原先403，使用该配置后200且登录表单存在。收到HTTP 4xx/5xx保留内嵌页，允许手动刷新；记录限定状态码与失败阶段，禁止记录网址、Cookie、表单或响应体。

类型/构建/17模块、46项两进程WK回归通过（`.test-artifacts/web-login-0k6GR1/`），其中新增403保留页面、手动刷新后继续真实WK交接。签名包66项通过（`.test-artifacts/package-check-EtaKZ0/`），包括Flash画面及游戏Session DIRECT。Luna只读复核无阻断。已安装0.1.13并校验签名和18个文件，0.1.12移入废纸篓供恢复，详见 `release/delivery.json`。当前待用户在安装版原窗口提交真实登录并验证进入游戏；未提交源码或上传。


## 2026-10-22 真实选区退主页：Cookie 身份修复

0.1.13实机原窗口直连已恢复登录与选区，点击S776仍退主页；日志定位交接快照失败。0.1.14补充受限诊断并安装后，实机明确为 `WEB_LOGIN_SNAPSHOT_duplicate-cookie`。原identity错误去掉domain前导点，把host-only和Domain Cookie折叠成一项；实际Electron11可同时保存同name/path的`host`与`.host`，因此不能按去点后的域判重。

0.1.15保留规范domain前导点，保留原Cookie属性及白名单。新增实际Electron回归在旧identity下失败（`.test-artifacts/web-login-yq3jOr/`），修正后通过；完整50项原生两进程专项通过（`.test-artifacts/web-login-dwOAWP/`），包含两种scope同时交接、删除任一scope、写入失败后恢复双scope。类型/构建/17模块通过；Luna最终只读复核无阻断。真实官网选区到Flash的最终安装版验证继续进行，尚不以合成测试代替该验证。


## 2026-10-22 0.1.17 分区 Cookie 隔离及真实游戏交接

0.1.15实机仍遇到duplicate-cookie；0.1.16进一步定位同身份记录的value和expirationDate不同。WebKit官方CookieCocoa.mm把StoragePartition纳入Cookie身份并保留到HTTPCookie.properties；getAllCookies可同时输出普通和分区Cookie，Electron11没有partitionKey，不能直接合并。0.1.17在Native records生成快照前排除非空StoragePartition项，分区项保留于WK，不降级成普通Cookie。完全一致的普通记录可归并，冲突普通记录仍在修改数据前拒绝，既有host-only/Domain区分保留。

53项专项通过（52项Electron/WK两进程检查+1项实际Swift records隔离检查），报告 `.test-artifacts/web-login-8tAEzf/`。Swift隔离测试已接入test:web-login，Luna独立复核无阻断。最终0.1.17已安装、深度验签和18项文件一致性通过；详细构建/恢复路径见release/delivery.json。最近完整66项外壳/Flash回归来自0.1.15（package-check-UBApjT），不得写成0.1.17重跑结果。

实机CUA在安装版原窗口恢复已登录选区页并点击S776；日志显示PARTITIONED_EXCLUDED_1和HANDOFF_RECEIVED，未再出现snapshot失败，原工具栏下已显示真实Flash加载画面（14%）。系统代理保持开启，启动器独立直连。等待加载完成再确认游戏主界面；未改代理全局模式、未提交或上传。


## 2026-10-22 0.1.18 最终实机验证通过

0.1.17解决了快照冲突并在原窗口进入Flash，但真实游戏14%连接失败，刷新出现iMSDK Token失败提示。0.1.18在Electron创建任何Session前启用进程级no-proxy-server，逐游戏partition仍设置DIRECT，WebKit独立数据存储的直连覆盖保留。只影响启动器，不改macOS/Clash/GPT/其他浏览器。GameSessions的HTTP错误诊断仅记录状态码与固定服务枚举，网络错误仅固定net::ERR代码；关闭会清除两项监听。0.1.17失败测试窗口曾被JS提示卡住，CUA两次超时且TERM无效后，精确结束该测试进程再安装，未操作其他应用。

最终0.1.18类型/构建/17模块、53项原生专项（52项Electron/WK+1项Swift分区隔离）、签名包66项通过。专项报告 `.test-artifacts/web-login-uOFaFv/`，实际包报告 `.test-artifacts/package-check-KjGoxB/`，包含defaultSession和游戏Session都DIRECT、主页零标签及实际Flash画面。Luna只读复核无阻断。安装签名和18项文件校验通过，恢复路径见release/delivery.json。

实机CUA确认已安装0.1.18冷启动只显示主页；点击巴西服后Cookie恢复到已登录选区页；点击S776后在同一主窗口加载Flash，最终已进入真实游戏主界面并显示游戏登录奖励弹窗。日志确认排除1个分区Cookie后交接完成，未再发生快照失败。当前保留该游戏会话供用户体验。无需重新输入密码，未领取游戏奖励、未提交源码或上传。此前待实机验收及锁屏阻塞至此解除。
