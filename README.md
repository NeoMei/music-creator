# Music Creator

> Suno AI 歌曲创作到抖音音乐发布的完整工作流 —— 生成 → 下载 WAV 无损音频 → 一键发布到汽水音乐。

基于 [OpenCLI](https://github.com/jackwener/opencli) + [CloakBrowser](https://github.com/jackwener/opencli)（反检测浏览器）驱动，全程命令行自动化，零 GUI 操作。

```
ocli suno generate  →  ocli suno download --formats wav --confirm-paid  →  node scripts/publish-douyin.cjs
   (创作歌曲)              (下载 WAV 无损音频)                                    (发布到抖音音乐)
```

## ✨ 功能

- 🎵 **歌曲生成**：自定义歌词、风格、人声性别，每次产出 2 个版本
- 🎧 **无损下载**：自动触发后台 WAV 生成并下载（需 Suno Premier）
- 🚀 **稳定发布**：独立 Node 脚本驱动抖音音乐表单，绕开 adapter 已知 bug
- 🛡️ **反检测**：全程走 CloakBrowser，登录态持久化，不被风控

## 📋 系统依赖

| 依赖 | 必需 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) ≥ 18 | ✅ | OpenCLI 运行时 |
| [@jackwener/opencli](https://github.com/jackwener/opencli) ≥ 1.7 | ✅ | `npm install -g @jackwener/opencli` |
| `ocli` wrapper | ✅ | opencli + CloakBrowser 反检测桥接；本 skill 所有命令用它 |
| CloakBrowser | ✅ | 反检测浏览器（CDP 9222），首次 `ocli` 调用自动拉起 |
| [playwright-core](https://www.npmjs.com/package/playwright-core) | ✅（发布） | `scripts/publish-douyin.cjs` 驱动抖音表单；`npm i -g playwright-core`，或由 aily-browser skill 的 node_modules 兜底 |
| [jq](https://stedolan.github.io/jq/) | 🟡 | 可选 |

> **为什么不能用桌面 Chrome？** Chrome 的登录 cookie 用 v11 加密绑定 profile，无法跨 profile 复制。本工作流的登录态必须维护在 CloakBrowser 的持久化 profile（`~/.openclaw/chrome-profile/`）里，重启不丢。

## 🚀 安装

### 1. 装系统依赖

```bash
# Node.js（用 nvm 或包管理器，需 ≥ 18）
node -v

# OpenCLI
npm install -g @jackwener/opencli
opencli --version

# playwright-core（发布用；aily-browser skill 在的话可跳过）
npm install -g playwright-core
```

### 2. 准备账号

在 **CloakBrowser** 里登录以下站点（不是桌面 Chrome）：

- **Suno** (suno.com) — **Premier 订阅**才能生成 WAV
- **抖音音乐开放平台** (music.douyin.com) — **创作者账号**才能发布

> 首次 `ocli` 调用会自动拉起 CloakBrowser。在其中手动登录一次，状态会持久化到 `~/.openclaw/chrome-profile/`。

### 3. 克隆并安装

```bash
git clone https://github.com/NeoMei/music-creator.git
cd music-creator
./install.sh
```

`./install.sh` 会检查上述全部依赖，并**只装 douyin-music fallback adapter**。它**不会覆盖官方 suno adapter**——官方版是 CloakBrowser/curl 补丁版，覆盖会让 WAV 下载失效。

> ⚠️ 不要手动 `cp -r adapters/suno ~/.opencli/clis/`，会破坏官方 adapter。仓库 `adapters/suno/` 下的自定义适配器是 legacy，仅作参考。

### 4. 配置环境变量

```bash
# Suno 生成需要 3-7 分钟，默认超时不够
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600
```

加到 `~/.bashrc` 或 `~/.zshrc` 持久化。

### 5. 验证

```bash
ocli suno list --limit 5   # 能列出 Suno Library = 登录态正常、全链路通
```

## 📖 使用

### Step 1：创作歌曲

```bash
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
  --tags 'Chinese folk ballad, warm acoustic guitar, storytelling female vocal' \
  --lyrics '[Verse]\n两棵树在风雨里\n长成了彼此的形状\n[Chorus]\n我们是两棵树\n根在地下紧紧缠绕' \
  --title '两棵树'
```

每次生成消耗 10 credits，产出 2 个版本。**保存返回的 clip-id**，后续下载和发布都需要。

#### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--lyrics` | 是（或 `--instrumental`） | 完整歌词，可含 `[Verse]/[Chorus]` 标签 |
| `--tags` | 是 | 风格标签，**必须英文**。人声性别也写这里（如 `female vocal`） |
| `--title` | 否 | 歌曲标题（不填则从歌词派生） |
| `--instrumental` | 否 | 纯音乐模式（与 `--lyrics` 互斥） |
| `--negative-tags` | 否 | 风格排除，如 `"no autotune, no heavy drums"` |
| `--model` | 否 | 模型：`chirp-fenix`（默认）/ `chirp-bluejay` / `chirp-v4` / `chirp-v3-5` |
| `--formats` | 否 | 生成后顺带下载：`mp3,m4a,wav,cover,metadata` |
| `--sd` | 否 | 只生成不下载，仅打印 clip-id（批量生成用） |
| `--timeout` | 否 | 等待生成的最长秒数，默认 300 |

> **中文风格必须先翻译成英文**，否则报 `TRANSLATE_REQUIRED`。

### Step 2：下载音频

```bash
# MP3 + M4A（免费，立即可用）
ocli suno download <clip-id> --formats mp3,m4a --op ~/Music/

# WAV 无损（付费，需 Premier；自动触发后台生成并下载，约 10-30 秒）
ocli suno download <clip-id> --formats wav --confirm-paid --op ~/Music/

# 一次全下：音频 + 封面 + 元数据
ocli suno download <clip-id> --formats mp3,m4a,wav,cover,metadata --confirm-paid --op ~/Music/
```

#### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `<clip-id>` | 是 | Suno clip ID（UUID） |
| `--formats` | 是 | 格式组合：`mp3` / `m4a` / `wav` / `video` / `cover` / `metadata`，逗号分隔 |
| `--confirm-paid` | WAV 必需 | 确认付费下载（WAV 是付费格式） |
| `--op` | 否 | 输出目录，默认当前目录 |
| `--timeout` | 否 | 等待 WAV 生成的最长秒数 |

> 没有 `generate-wav` 这个命令——WAV 由 `download --formats wav --confirm-paid` 自动触发并下载。不加 `--confirm-paid` 时 WAV 会被跳过并给出提示。

#### 音频格式对比

| 格式 | 可用性 | 音质 | 文件大小 | 适用场景 |
|------|--------|------|----------|----------|
| **M4A** | ✅ 始终可用 | ⭐⭐⭐ 很好 | ~5MB | 推荐日常预览 |
| **MP3** | ✅ 始终可用 | ⭐⭐ 好 | ~3MB | 兼容性最好 |
| **WAV** | 🟡 付费（Premier + `--confirm-paid`） | ⭐⭐⭐⭐⭐ 无损 | ~40MB | **发布到音乐平台** |

抖音音乐开放平台要求 **WAV 格式**，发布前必须拿到 WAV。

#### 备用：CDN 直链

`download` 失败时可用 CDN 直取（WAV 需先生成）：

```
WAV:  https://cdn1.suno.ai/<clip-id>.wav
M4A:  https://cdn1.suno.ai/<clip-id>.m4a
MP3:  https://cdn1.suno.ai/<clip-id>.mp3
封面: https://cdn2.suno.ai/image_<clip-id>.jpeg
```

### Step 3：发布到抖音音乐

⚠️ `ocli douyin-music publish` adapter 有已知 bug（封面上传后不点裁剪确认弹窗、Suno 多选下拉不关闭 → 超时 teardown，表单和已传音频全丢）。**改用仓库自带发布脚本** `scripts/publish-douyin.cjs`：经 CDP 直连 CloakBrowser 驱动 Semi Design 表单，补齐了 adapter 漏的两步，且脚本退出后表单不丢。

```bash
# 在仓库根目录运行（用相对路径）
node scripts/publish-douyin.cjs \
  --audio ~/Music/两棵树_<clip-id>.wav \
  --cover ~/Music/两棵树_<clip-id>_cover.jpeg \
  --title '两棵树' \
  --lyrics "$(cat ~/Music/两棵树_<clip-id>_lyrics.txt)" \
  --ai-tools Suno \
  --music-type 原创
```

#### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--audio` | 是 | WAV 音频文件路径（时长 ≥ 60s） |
| `--cover` | 是 | 封面图片路径（**≥ 1440×1440**，见下方要求） |
| `--title` | 是 | 歌曲标题 |
| `--lyrics` | 否 | 歌词文本（直接传内容，不是文件路径） |
| `--ai-tools` | 否 | 使用的 AI 工具，默认 `Suno` |
| `--music-type` | 否 | 音乐类型：`原创`（默认）/ `原创伴奏` / `翻唱` / `Remix` |
| `--artist` | 否 | 表演者（当前不覆盖，自动取抖音音乐人账户艺名） |
| `--submit` | 否 | 不加 = 只填表单+上传+点确认（便于检查）；加上才点最终提交 |

#### 封面要求（重要）

抖音硬性要求 **≥ 1440×1440**。Suno 原生封面是 1024×1024，发布前必须放大：

```bash
python3 -c "from PIL import Image; im=Image.open('cover.jpeg'); im.resize((1500,1500),Image.LANCZOS).save('cover_1500.jpeg','JPEG',quality=90)"
```

#### 两步发布（推荐）

1. **先不加 `--submit` 跑一遍**：脚本填表单 + 上传音频/封面 + 点裁剪确认，但不点最终提交。你可以在 CloakBrowser 里核对每个字段。
2. **确认无误后加 `--submit` 重跑**：脚本点提交按钮完成发布。

脚本逐步完成：AI 声明（是）→ 选 Suno（真实 click + 关闭下拉）→ 音乐类型（原创）→ 标题/歌词 → 音频上传 → 封面上传 + 点裁剪确认弹窗 →（可选）提交。

## 🎵 完整端到端示例

```bash
# Step 1: 生成歌曲
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
  --tags 'Chinese folk ballad, warm acoustic guitar, storytelling female vocal' \
  --lyrics '[Verse]\n两棵树在风雨里\n长成了彼此的形状\n[Chorus]\n我们是两棵树\n根在地下紧紧缠绕' \
  --title '两棵树'
# → 记录返回的 clip-id，假设 45fdb007-bcd4-485f-9a7c-4b38f8d96324

# Step 2: 下载 WAV + 封面 + 歌词
ocli suno download 45fdb007-bcd4-485f-9a7c-4b38f8d96324 \
  --formats wav,cover,metadata --confirm-paid --op ~/Music/

# Step 3: 发布到抖音音乐（先预览，确认后加 --submit）
node scripts/publish-douyin.cjs \
  --audio ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324.wav \
  --cover ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_cover.jpeg \
  --title '两棵树' \
  --lyrics "$(cat ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_lyrics.txt)" \
  --ai-tools Suno --music-type 原创
```

## 🧭 命令速查

```bash
# 生成歌曲
ocli suno generate --tags '<英文风格>' --lyrics '<歌词>' --title '<标题>'

# 下载 WAV（Premier 必需）
ocli suno download <clip-id> --formats wav --confirm-paid --op ~/Music/

# 发布到抖音音乐（先预览，确认后加 --submit）
node scripts/publish-douyin.cjs --audio <wav> --cover <jpeg> --title '<标题>' --lyrics '<歌词>'

# 列出歌曲
ocli suno list --limit 20

# 环境自检
opencli doctor
```

## 📁 项目结构

```
music-creator/
├── README.md                         # 本文件
├── SKILL.md                          # Skill 定义（给 AI agent 的密集命令参考）
├── install.sh                        # 环境检查 + 安装 douyin-music fallback adapter
├── scripts/
│   └── publish-douyin.cjs            # ★ 发布脚本（绕开 adapter bug，实际在用）
└── adapters/
    ├── douyin-music/
    │   └── publish.js                # 发布 adapter（有 bug，仅作 fallback）
    └── suno/                         # ⚠️ legacy 自定义适配器（已弃用，保留作参考）
        ├── create-advanced.js          # 旧版 Advanced 生成（现用官方 suno generate）
        ├── generate-wav.js             # 旧版 WAV 触发（现用 suno download --formats wav）
        ├── download.js                 # 旧版下载（现用官方 suno download）
        └── list.js                     # 旧版列表（现用官方 suno list）
```

## 🏗️ 架构说明

### 为什么用 ocli / CloakBrowser？

`ocli` = opencli + 按需 CloakBrowser。Suno 和抖音音乐都有反爬检测，直接用桌面 Chrome 会触发风控。CloakBrowser 是反检测浏览器（Chrome 146、`webdriver=false`），登录态持久化在独立 profile 里。`ocli` wrapper 在调用浏览器命令前自动确保 CloakBrowser 在 CDP 9222 运行，并路由到正确 profile。

### 为什么有独立的 publish-douyin.cjs？

OpenCLI 的 `douyin-music publish` adapter（`adapters/douyin-music/publish.js`）有两个未修 bug：

1. 封面上传后不点裁剪确认弹窗 → 超时
2. Suno 多选下拉选了不关闭 → 弹窗挂住

导致表单和已传音频在 teardown 时全丢。`scripts/publish-douyin.cjs` 用 playwright-core 经 CDP 直连 CloakBrowser，补齐了这两步，且退出后表单不丢。

### adapters/suno/ 里的文件为什么是 legacy？

它们是早期自定义实现。OpenCLI 官方后来发布了为 CloakBrowser/curl 打补丁的 suno adapter（`suno generate` / `suno download`），支持更稳。`install.sh` 明确**不覆盖**官方版；仓库里这些 legacy 文件仅作历史参考。

## ❓ 常见问题

### Q1: `TRANSLATE_REQUIRED` 错误

`--tags` 参数包含中文。必须先翻译成英文：

```bash
# ❌ 错误
--tags '中国民谣，温暖木吉他'

# ✅ 正确
--tags 'Chinese folk ballad, warm acoustic guitar'
```

### Q2: `AuthRequiredError` 错误

CloakBrowser 里未登录。在 **CloakBrowser**（不是桌面 Chrome）中访问并登录一次：
- `suno.com`
- `music.douyin.com`

登录状态持久化到 CloakBrowser profile，重启后仍保持。可选自检：`bash ~/.openclaw/workspace/scripts/verify-browser-stack.sh`

### Q3: WAV 下载失败 / 403

WAV 是付费格式，需要：
1. Suno **Premier 订阅**
2. 加 `--confirm-paid` 参数

```bash
ocli suno download <clip-id> --formats wav --confirm-paid --timeout 600 --op ~/Music/
```

不加 `--confirm-paid` 时 WAV 会被跳过。不要手动改 User-Agent 或 Referer。

### Q4: 发布失败 / 表单字段没填上

1. 在 CloakBrowser 重新登录 `music.douyin.com`
2. 确认封面 ≥ 1440×1440（Suno 原生 1024 不够，需放大）
3. 确认音频时长 ≥ 60s
4. 第一次不加 `--submit` 跑，在浏览器里核对表单

### Q5: 生成超时

```bash
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600   # 10 分钟，加到 ~/.bashrc 持久化
```

## 🔧 维护与升级

本仓库的工作流：**在本地改 → commit → push**。

```bash
git add -A
git commit -m "描述改动"
git push origin main
```

升级到最新版：

```bash
git pull origin main
./install.sh   # 重新检查依赖、刷新 adapter
```

## License

MIT
