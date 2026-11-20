# 方案 C 实现映射

已确认预览：`design-preview/toolbar-v2.html` 的 C 轻分段。

| 预览 | 实际实现 | 约束 |
| --- | --- | --- |
| titlebar / C | renderer/style.css .chrome、.tabline、.tab | 42px 顶栏，28×148px 标签，选中无阴影 |
| SF Symbols 工具图标 | renderer/icons.ts | 沿用预览导出的 4 倍 PNG，24px 视口，实际字形约 16pt |
| 原生红黄绿 | native/TrafficLights.mm、main/traffic-lights.ts | 缩放现有 AppKit 控件的 frame 与 bounds；实际圆点 14pt、间隙 8pt、中心 y=21pt，保留原生行为 |
| 外观设置 | shared/appearance.ts、main/config.ts、renderer/app.ts | 默认跟随系统；深浅色；颜色仅作用于标题栏 |
| 紧凑设置页 | renderer/index.html、style.css | 600px 内容宽，去编号、口号及重复解释；保留账号管理 |
| 游戏视口 | main/game.ts | 顶部偏移共享 42px 常量，保存密码提示另加 44px |
| 账号候选浮层 | preload/game.ts | 中性深浅色，保留原有凭据隔离和可信输入行为 |

真实游戏窗口不会热重载或关闭。原生尺寸修复已通过真实控件像素及窗口动作回归，当前开发构建下次启动生效。未打包或发布。
