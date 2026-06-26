# Music Creator

Suno 歌曲创作到发布的完整工作流：生成歌曲 → 下载 WAV 无损音频 → 发布到抖音音乐开放平台（汽水音乐）。

## 功能

- 🎵 **歌曲生成**：使用 Suno Advanced 模式自定义歌词、风格、人声性别
- 🎧 **WAV 下载**：自动触发后台生成无损音频并下载
- 🚀 **一键发布**：自动填写抖音音乐开放平台表单并提交

## 安装

### 1. 系统依赖

| 依赖 | 版本 | 验证命令 | 必需 |
|------|------|----------|------|
| [Node.js](https://nodejs.org/) | ≥ 18 | `node -v` | ✅ |
| [OpenCLI](https://github.com/jackwener/opencli) | ≥ 1.7.0 | `opencli --version` | ✅ |
| Google Chrome | 稳定版 | `google-chrome --version` | ✅ |
| [jq](https://stedolan.github.io/jq/) | 任意 | `jq --version` | 🟡 批量下载脚本用 |

```bash
# OpenCLI（一次性安装）
npm install -g @jackwener/opencli
opencli --version

# jq（可选，缺失时 suno-batch-download.sh 会回退到 grep 解析）
# macOS:  brew install jq
# Debian: sudo apt install jq
```

### 2. 账号准备

opencli 会复用 Chrome 默认 profile 的登录态，请先在 Chrome 中登录：

- **Suno** (suno.com) — **Premier 订阅**才能生成 WAV
- **抖音音乐开放平台** (music.douyin.com) — **创作者账号**才能发布

> opencli 会自动启动 Chrome（有头模式），无需手动保持开启。首次使用前在 Chrome 里登录上述站点即可。

### 3. 安装 Adapters

```bash
git clone https://github.com/NeoMei/music-creator.git
cd music-creator
./install.sh
```

`install.sh` 会把 `adapters/` 复制到 `~/.opencli/clis/`。它会：

- 检查 Node ≥ 18 / OpenCLI / Chrome（缺则报错或告警）
- **自动备份被覆盖的同名文件**（本技能自带的 `suno/download.js`、`suno/list.js` 与 OpenCLI 内置版同名，会覆盖后者，原文件备份到 `~/.opencli/clis/suno/.backup-pre-music-creator-*`，可恢复）
- 装完后逐个验证 adapter 能否加载

> 手动安装：`cp -r adapters/suno ~/.opencli/clis/ && cp -r adapters/douyin-music ~/.opencli/clis/`（但不会备份，推荐用 `install.sh`）

### 4. 环境变量

```bash
# Suno 生成需要 3-7 分钟，默认超时不够
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600
```

加到 `~/.bashrc` 或 `~/.zshrc` 持久化。

### 5. 验证安装

```bash
opencli suno create-advanced --help   # 应打印帮助
opencli suno generate-wav --help
opencli suno download --help
opencli suno list --help
opencli douyin-music publish --help
```

五条都正常打印帮助文本 = 安装成功。再做一次冒烟测试：

```bash
opencli suno list --limit 5   # 能列出你的 Suno Library = 登录态正常
```

## 快速开始

### 1. 生成歌曲

```bash
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 opencli suno create-advanced \
  --styles 'Chinese folk ballad, warm acoustic guitar, storytelling female vocal' \
  --lyrics '[Verse]\n两棵树在风雨里\n长成了彼此的形状' \
  --title '两棵树' \
  --vocal-gender female
```

**中文风格需要先翻译成英文**，否则会报 `TRANSLATE_REQUIRED` 错误。

### 2. 下载 WAV

```bash
# 使用 clip-id（上一步返回的）
opencli suno generate-wav <clip-id> --output-dir ~/Music/
```

### 3. 发布到抖音音乐

```bash
opencli douyin-music publish \
  --audio ~/Music/两棵树_<clip-id>.wav \
  --cover ~/Music/两棵树_<clip-id>_cover.jpeg \
  --title '两棵树' \
  --artist 'NeoMei' \
  --lyrics "$(cat ~/Music/两棵树_<clip-id>_lyrics.txt)" \
  --ai-tools Suno \
  --music-type 原创
```

## 完整工作流

```
suno create-advanced → generate-wav → douyin-music publish
```

详细参数说明见 [SKILL.md](SKILL.md)。

## 批量下载

`suno-batch-download.sh` 可一次性下载 Suno Library 里的全部歌曲：

```bash
# 默认 m4a 格式，输出到 ~/openclaw/media/inbound/
./suno-batch-download.sh

# 指定格式 (mp3/wav/m4a)
./suno-batch-download.sh wav

# 指定输出目录
./suno-batch-download.sh m4a /path/to/output
```

每次下载间隔 2 秒以防触发 rate limit；日志保存在输出目录，命名 `suno-download-YYYYMMDD-HHMMSS.log`。建议用 [jq](https://stedolan.github.io/jq/) 获得更精确的列表解析（未安装时脚本会回退到 grep 解析）。

## 音频格式

| 格式 | 可用性 | 音质 | 文件大小 | 适用场景 |
|------|--------|------|----------|----------|
| **M4A** | ✅ 始终可用 | ⭐⭐⭐ 很好 | ~5MB | 推荐日常使用 |
| **MP3** | ✅ 始终可用 | ⭐⭐ 好 | ~3MB | 兼容性最好 |
| **WAV** | 🟡 需先生成 | ⭐⭐⭐⭐⭐ 无损 | ~40MB | 发布到音乐平台 |

抖音音乐开放平台要求 **WAV 格式**。

## 常见问题

### 1. `TRANSLATE_REQUIRED` 错误

`--styles` 包含中文。需要先翻译成英文：

```bash
# ❌ 错误
--styles '中国民谣，温暖木吉他'

# ✅ 正确
--styles 'Chinese folk ballad, warm acoustic guitar'
```

### 2. `AuthRequiredError` 错误

Chrome 中未登录 Suno 或抖音音乐。在 Chrome 中手动访问：
- `suno.com` — 登录
- `music.douyin.com` — 登录

### 3. WAV 下载 403

WAV 尚未生成。使用 `suno generate-wav` 命令会自动等待，或手动在 Suno Library 页面触发。

### 4. 发布失败

抖音音乐页面改版。检查：
1. 重新登录 `music.douyin.com`
2. URL 是否为 `https://music.douyin.com/console/complete-publish`
3. 添加 `--trace retain-on-failure` 查看调试信息

### 5. 生成超时

```bash
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600  # 10 分钟
```

## 项目结构

```
music-creator/
├── SKILL.md                          # Skill 定义（AI agent 使用）
├── README.md                         # 本文件
├── install.sh                        # 一键安装脚本
├── suno-batch-download.sh            # 批量下载 Library 全部歌曲
└── adapters/
    ├── suno/
    │   ├── create-advanced.js        # Advanced 模式生成（自定义歌词/风格）
    │   ├── create.js                 # Simple 模式生成（自然语言描述）
    │   ├── generate-wav.js           # 触发并下载 WAV 无损音频
    │   ├── download.js               # 下载音频（API 优先，CDN 兜底）
    │   ├── download-ui.js            # UI 策略下载（intercept）
    │   └── list.js                   # 列出 Library 歌曲
    └── douyin-music/
        └── publish.js                # 发布到抖音音乐开放平台
```

## 依赖

见上方[安装](#安装)章节。

## License

MIT
