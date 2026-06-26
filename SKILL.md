---
name: music-creator
description: Suno 歌曲创作完整工作流：生成歌曲 → 下载 WAV → 发布到抖音音乐开放平台。支持自定义歌词、风格，可选纯音乐，自动触发 WAV 无损生成，并支持一键发布到汽水音乐。
allowed-tools: Bash(opencli:*), Bash(ocli:*), Read, Edit, Write
---

# Suno 歌曲创作完整工作流

本 skill 覆盖从歌曲生成到发布的完整链路：

```
创作歌曲 (suno generate)
    ↓
下载 WAV 无损音频 (suno download --formats wav)
    ↓
发布到抖音音乐 (publish-douyin.cjs)
```

**目标**：零配置、全自动化，一次命令完成从创意到发布的全过程。

---

## 前置条件

1. **反检测浏览器**：用 `ocli`（= opencli + 按需 CloakBrowser）执行所有命令，首次调用会自动后台拉起 CloakBrowser（Chrome 146、`webdriver=false`）。CloakBrowser 的持久化 profile 需已登录：
   - Suno (suno.com) — 需要 Premier 订阅才能生成 WAV
   - 抖音音乐开放平台 (music.douyin.com) — 需要创作者账号

   > 由于 Chrome 加密登录 cookie（v11），登录态**不能**从日常 Chrome profile 复制继承。请在 CloakBrowser 中手动登录一次；登录状态会持久化到 `~/.openclaw/chrome-profile/`，重启后仍保持。若提示未登录，检查 CloakBrowser 是否加载了正确的 profile。
   > 可选自检：`bash ~/.openclaw/workspace/scripts/verify-browser-stack.sh`

2. **环境变量设置**（Suno 生成需要 3-7 分钟）：
   ```bash
   export OPENCLI_BROWSER_COMMAND_TIMEOUT=600
   ```

3. **WAV 生成需要 Suno Pro/Premier 订阅**，免费版无法生成 WAV。

4. **浏览器操作必须走 CloakBrowser + opencli 工具链**，禁止直接使用桌面 Chrome 或 Playwright。
   详见 `skills/aily-browser/SKILL.md`。

---

## 工作流

### Step 1: 创作歌曲

使用 `suno generate` 生成歌曲，每次消耗 10 积分，产出 2 个版本。

```bash
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
  --tags '<英文风格描述>' \
  --lyrics '<歌词>' \
  --title '<标题>'
```

#### 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--lyrics` | 是（或 `--instrumental`） | 完整歌词，可含 `[Verse]/[Chorus]` 标签。填写即进入 Custom 模式 |
| `--tags` | 是（与 `--lyrics` 配合） | 风格标签，**必须是英文**。如 `"Chinese folk ballad, warm acoustic guitar, female vocal"`（人声性别也写这里） |
| `--title` | 否 | 歌曲标题（不填则自动从歌词派生） |
| `--instrumental` | 否 | 纯音乐模式（与 `--lyrics` 互斥），默认 false |
| `--negative-tags` | 否 | 风格排除，如 `"no autotune, no heavy drums"` |
| `--model` | 否 | 模型：`chirp-fenix`(默认) / `chirp-bluejay` / `chirp-v4` / `chirp-v3-5` |
| `--formats` | 否 | 生成后顺带下载：`mp3,m4a,wav,cover,metadata`（默认只出 mp3+metadata） |
| `--sd` | 否 | 只生成不下栽，仅打印 clip-id（批量生成用） |
| `--timeout` | 否 | 等待生成完成的最长秒数，默认 300 |

#### 中文处理

**如果用户用中文描述风格，必须先翻译成英文再调用**。直接传中文会返回 `TRANSLATE_REQUIRED` 错误。

```bash
# ❌ 错误
--tags '中国民谣，温暖木吉他'

# ✅ 正确
--tags 'Chinese folk ballad, warm acoustic guitar'
```

#### 返回结果

成功后会返回 2 个版本：

```yaml
- id: "clip-id-1"
  title: "歌曲标题"
  audio_url: "https://cdn1.suno.ai/clip-id-1.mp3"
  image_url: "https://cdn2.suno.ai/image_clip-id-1.jpeg"
  duration: 180
  status: complete

- id: "clip-id-2"
  title: "歌曲标题"
  audio_url: "https://cdn1.suno.ai/clip-id-2.mp3"
  image_url: "https://cdn2.suno.ai/image_clip-id-2.jpeg"
  duration: 180
  status: complete
```

**保存这两个 clip-id**，后续下载和发布都需要。

---

### Step 2: 下载 WAV 无损音频

下载用 `ocli suno download`，`--formats` 指定格式（mp3/m4a/wav/video/cover/metadata），`--op` 指定输出目录。WAV 是付费格式，需加 `--confirm-paid` 且要求 Premier 订阅。

#### 下载任意格式（推荐）

```bash
# MP3 + M4A（免费，立即可用）
ocli suno download <clip-id> --formats mp3,m4a --op ~/Music/

# WAV 无损（付费，需 Premier；自动触发后台生成并下载，约 10-30 秒）
ocli suno download <clip-id> --formats wav --confirm-paid --op ~/Music/

# 一次全下：音频 + 封面 + 元数据
ocli suno download <clip-id> --formats mp3,m4a,wav,cover,metadata --confirm-paid --op ~/Music/
```

> 没有 `generate-wav` 这个命令——WAV 由 `download --formats wav --confirm-paid` 自动触发并下载。不加 `--confirm-paid` 时 WAV 会被跳过并给出提示。

#### 备用：CDN 直链

`download` 失败时可用 CDN 直取（WAV 需先生成）：
```
WAV:  https://cdn1.suno.ai/<clip-id>.wav
M4A:  https://cdn1.suno.ai/<clip-id>.m4a（音质最好，始终可用）
MP3:  https://cdn1.suno.ai/<clip-id>.mp3（始终可用）
封面: https://cdn2.suno.ai/image_<clip-id>.jpeg
```

#### 音频格式对比

| 格式 | 可用性 | 音质 | 文件大小 | 适用场景 |
|------|--------|------|----------|----------|
| **M4A** | ✅ 始终可用 | ⭐⭐⭐ 很好 | ~5MB | 推荐日常使用 |
| **MP3** | ✅ 始终可用 | ⭐⭐ 好 | ~3MB | 兼容性最好 |
| **WAV** | 🟡 付费（Premier） | ⭐⭐⭐⭐⭐ 无损 | ~40MB | 发布到音乐平台 |

**抖音音乐开放平台要求 WAV 格式**，发布前用 `download --formats wav --confirm-paid` 拿到 WAV。

---

### Step 3: 发布到抖音音乐开放平台

⚠️ `ocli douyin-music publish` adapter 有 bug:封面上传后不点裁剪确认弹窗、Suno 多选下拉不关闭 → 超时 teardown,表单和已传音频全丢(1.8.3/1.8.4 均未修)。**改用仓库自带发布脚本** `scripts/publish-douyin.cjs`:经 CDP 直连 CloakBrowser 驱动 Semi Design 表单,补齐了 adapter 漏的两步,且脚本退出后表单不丢(不像 adapter 会 teardown)。

```bash
# 前置:WAV(时长 ≥60s)、封面(≥1440×1440)、歌词文本
node ~/.openclaw/workspace/skills/music-creator/scripts/publish-douyin.cjs \
  --audio <wav> \
  --cover <jpeg> \
  --title '<标题>' \
  --lyrics '<歌词文本>' \
  --ai-tools Suno \
  --music-type 原创
# 不加 --submit = 只填表单+上传+点确认(便于检查);加 --submit 才真发布
```

脚本逐步完成:AI 声明(是)→ 选 Suno(真实 click + 关闭下拉)→ 音乐类型(原创)→ 标题/歌词 → 音频上传 → **封面上传 + 点裁剪确认弹窗** → (可选)提交。已实测全字段写入正确(标题/歌词/音频/封面/Suno 全 ✅)。

#### 封面要求(重要)

抖音硬性要求 **≥1440×1440**。Suno 原生封面是 1024×1024,发布前必须放大:
```bash
python3 -c "from PIL import Image; im=Image.open('cover.jpeg'); im.resize((1500,1500),Image.LANCZOS).save('cover_1500.jpeg','JPEG',quality=90)"
```

#### 真发布

确认表单无误后,加 `--submit` 重跑,脚本点提交按钮完成发布。建议第一次先不加 `--submit` 跑一遍核对,再用真歌 + `--submit` 正式发。

> artist(表演者/词曲作者)会自动取抖音音乐人账户的艺名(「点点」),`--artist` 参数当前不覆盖。

---

## 完整工作流示例

### 示例 1：完整流程（从生成到发布）

```bash
# Step 1: 生成歌曲
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
  --tags 'Chinese folk ballad, warm acoustic guitar, storytelling female vocal' \
  --lyrics '[Verse]\n两棵树在风雨里\n长成了彼此的形状\n[Chorus]\n我们是两棵树\n根在地下紧紧缠绕' \
  --title '两棵树'

# 记录返回的 clip-id（假设是 45fdb007-bcd4-485f-9a7c-4b38f8d96324）

# Step 2: 下载 WAV
ocli suno download 45fdb007-bcd4-485f-9a7c-4b38f8d96324 --formats wav --confirm-paid \
  --op ~/Music/

# Step 3: 发布到抖音音乐(adapter 有 bug,改用 publish-douyin.cjs 脚本)
node ~/.openclaw/workspace/skills/music-creator/scripts/publish-douyin.cjs \
  --audio ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324.wav \
  --cover ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_cover.jpeg \
  --title '两棵树' \
  --lyrics "$(cat ~/Music/两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_lyrics.txt)" \
  --ai-tools Suno --music-type 原创 --submit
```

### 示例 2：只下载不发布

```bash
# 下载两个版本的 WAV
ocli suno download <clip-id-1> --formats wav --confirm-paid --op ~/Music/
ocli suno download <clip-id-2> --formats wav --confirm-paid --op ~/Music/
```

### 示例 3：批量发布多首歌曲

```bash
# 批量发布(adapter 坏,逐个调 publish-douyin.cjs 脚本)
for clip_id in "id1" "id2" "id3"; do
  echo "Publishing $clip_id..."
  node ~/.openclaw/workspace/skills/music-creator/scripts/publish-douyin.cjs \
    --audio ~/Music/${clip_id}.wav \
    --cover ~/Music/${clip_id}_cover.jpeg \
    --title "Song $clip_id" \
    --ai-tools Suno --music-type 原创 --submit
done
```

---

## 常见问题

### Q1: `TRANSLATE_REQUIRED` 错误

**原因**：`--tags` 参数包含中文。  
**解决**：先将中文风格翻译成英文再调用。

```bash
# ❌ 错误
--tags '中国民谣，温暖木吉他'

# ✅ 正确
--tags 'Chinese folk ballad, warm acoustic guitar'
```

### Q2: `AuthRequiredError` 错误

**原因**：Chrome 中 Suno 或抖音音乐未登录。  
**解决**：
1. 在 CloakBrowser 中打开 `suno.com` 并登录
2. 在 CloakBrowser 中打开 `music.douyin.com` 并登录
3. 重新运行命令

### Q3: WAV 下载失败 / 403 错误

**原因**：WAV 尚未生成完成。  
**解决**：
1. 使用 `suno download --formats wav --confirm-paid`（自动触发并等待生成）
2. 或手动在 Suno Library 页面点击 "Download → WAV Audio" 触发
3. 等待 10-30 秒后重试

### Q4: 抖音音乐发布失败 / 页面元素找不到

**原因**：抖音音乐页面改版或登录态过期。  
**解决**：
1. 在 CloakBrowser 中重新登录 `music.douyin.com`
2. 检查页面 URL 是否为 `https://music.douyin.com/console/complete-publish`
3. 如果页面结构大幅改版，需要更新 adapter

### Q5: Suno 生成超时

**原因**：歌曲生成需要 3-7 分钟，默认超时时间不够。  
**解决**：
```bash
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600  # 10 分钟
```

---

## 文件输出结构

下载完成后，输出目录包含：

```
~/Music/
├── 两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324.wav       # 无损音频
├── 两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324.mp3       # MP3 版本
├── 两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_cover.jpeg # 封面图
└── 两棵树_45fdb007-bcd4-485f-9a7c-4b38f8d96324_lyrics.txt # 歌词文本
```

---

## 高级技巧

### 批量生成歌曲

```bash
# 创建批量生成脚本
styles="Chinese folk ballad, warm acoustic guitar"
for i in {1..5}; do
  echo "Generating song $i..."
  OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
    --tags "$styles" \
    --lyrics "Song $i lyrics here..." \
    --title "Song $i"
done
```

### 自动翻译风格

如果用户坚持用中文描述风格，你可以先用 LLM 翻译：

```bash
# 用户输入："中国民谣，温暖木吉他，叙事女声"
# 翻译后："Chinese folk ballad, warm acoustic guitar, storytelling female vocal"
```

### 使用 M4A 作为预览

M4A 音质优于 MP3 且文件更小，适合快速预览：

```bash
ocli suno download <clip-id> --formats m4a --op ~/Music/
```

---

## 关键约定

- **浏览器命令一律用 `ocli`**：自动经 CloakBrowser（反检测）驱动；不要用裸 `opencli` 跑 suno/douyin-music（会落到日常 Chrome，无反检测）
- **Suno 需要 Premier 订阅**：免费版无法生成 WAV
- **抖音音乐需要创作者账号**：普通用户无法发布
- **每次生成消耗 10 credits**：产出 2 个版本
- **WAV 生成是异步的**：需要 10-30 秒等待时间
- **文件命名格式**：`<title>_<clip-id>.<ext>`

---

## 故障排查

如果整个工作流卡住：

1. **检查 CloakBrowser 是否开启**：`opencli doctor`
2. **检查登录状态**：在 Chrome 中手动访问 `suno.com` 和 `music.douyin.com`
3. **检查订阅状态**：Suno 账户是否显示 "Premier"
4. **检查网络**：CDN 链接是否可访问 `curl -I https://cdn1.suno.ai/<clip-id>.wav`
5. **查看 trace**：加 `--trace retain-on-failure` 保留调试信息

---

## 参考命令速查

```bash
# 生成歌曲
ocli suno generate --tags '<英文风格>' --lyrics '<歌词>' --title '<标题>'

# 下载 WAV
ocli suno download <clip-id> --formats wav --confirm-paid --op ~/Music/

# 下载 MP3/M4A
ocli suno download <clip-id> --formats mp3,m4a,wav --confirm-paid --op ~/Music/

# 发布到抖音音乐(adapter 有 bug,用脚本;先不加 --submit 预览,确认后加 --submit)
node skills/music-creator/scripts/publish-douyin.cjs --audio <wav> --cover <jpeg> --title '<标题>' --lyrics '<歌词>'

# 列出所有歌曲
ocli suno list --limit 20

# 检查环境
opencli doctor
```
