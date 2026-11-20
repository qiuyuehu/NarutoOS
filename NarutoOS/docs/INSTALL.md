# 安装与源码运行

## 下载应用包

打开 [GitHub Releases](https://github.com/qiuyuehu/NarutoOS/releases)，下载 Assets 中的 macOS 应用附件。ZIP 解压或打开 DMG 后，把 Naruto OS.app 拖入「应用程序」。

以下步骤适用于 Apple Silicon Mac 和 macOS 15 或更新版本。游戏运行部分是 Intel 版本，首次打开时如果系统提示安装 Rosetta，请按提示完成。

### 使用命令行下载

已安装 [GitHub CLI](https://cli.github.com/) 的用户可在终端执行：

```sh
gh release download --repo qiuyuehu/NarutoOS \
  --pattern '*.zip' --pattern '*.dmg' \
  --dir "$HOME/Downloads/NarutoOS-release"
open "$HOME/Downloads/NarutoOS-release"
```

下载完成后解压 ZIP 或打开 DMG，将应用拖入「应用程序」。

命令用法见 [GitHub CLI 官方文档](https://cli.github.com/manual/gh_release_download)。

## 从源码运行

### 准备环境

- Apple Silicon Mac，macOS 15 或更新版本，已安装 Rosetta。
- Git、Node.js **22.12 或更新版本**、pnpm **11**、Python **3**。
- Xcode Command Line Tools（包含 Swift 和 Clang）。

首次准备编译工具：

```sh
xcode-select --install
```

Node.js、pnpm、Python 的安装说明：

- [Node.js](https://nodejs.org/en/download)
- [pnpm](https://pnpm.io/installation)
- [Python](https://www.python.org/downloads/macos/)

安装 Node.js 后，可用 `npm install -g pnpm@11` 安装本项目使用的 pnpm 版本。

### 拉取并准备项目

```sh
git clone https://github.com/qiuyuehu/NarutoOS.git
cd NarutoOS/NarutoOS
npm_config_arch=x64 pnpm install --frozen-lockfile
python3 scripts/prepare-runtime.py
pnpm prototype:build
```

Electron 必须为 **x64**，以匹配 Intel Flash；Swift 启动界面在本机编译。

准备脚本会把 Flash 34 放进项目的 `runtime/flash-34/`，不会修改系统插件。

默认只需 Flash 34。若需要 Flash 31，且本机留有脚本可识别的 360Chrome 旧版 Flash 组件，可执行：

```sh
python3 scripts/prepare-runtime.py --fallback31
```

该选项仅复制现有插件，不修改 360Chrome。

### 运行离线预览

```sh
pnpm start
```

默认使用合成账号与本地 Flash 样本，供检查界面与交互，不访问游戏官网。数据位于 `.test-artifacts/native-core-preview/`。

修改源码后，重新构建并启动：

```sh
pnpm dev
```

### 连接真实官网

```sh
node scripts/start-native-prototype.mjs --live
```

开发模式使用独立的 `.test-artifacts/native-core-dev/` 数据目录，请在打开的页面中手动登录。它不复用安装版的账号资料；游戏会话会跟随系统代理设置。切换运行模式前，请先正常退出仍在使用该数据目录的进程。

巴西服部分汉化可在设置中开启。开发态达摩辅助需要另行生成实验补丁资源并显式启用，普通源码运行不自动提供；安装包已包含相应资源。具体构建过程见[打包记录中的达摩辅助说明](LOCAL-PACKAGE.md#022-达摩辅助随包)。

### 检查与打包说明

```sh
pnpm verify
```

执行类型检查、构建与模块测试；不会测试真实账号登录，也不会检查最终安装包。更多专项命令见[开发说明](../README.md#验证)。

源码运行不会生成或安装应用。现有打包脚本还需要 Flash 31、34 两套组件及项目资源；打包流程见[本地打包说明](LOCAL-PACKAGE.md)。

## 兼容与首次打开

当前登录组件要求 macOS 15 或更新版本，具体发布包以对应发布说明为准。

应用包采用本地 ad-hoc 签名，尚未进行 Developer ID 公证。遇到 macOS 拦截时，确认来源后按 [Apple 官方说明](https://support.apple.com/zh-cn/102445)处理，无需关闭全局安全保护。
