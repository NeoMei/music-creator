#!/bin/bash
# Suno 批量下载脚本
# Usage: ./suno-batch-download.sh [format] [output-dir]
#   format: mp3 | wav | m4a (默认: wav)
#   output-dir: 输出目录 (默认: ~/openclaw/media/inbound/)

set -e

FORMAT="${1:-m4a}"
OUTPUT_DIR="${2:-$HOME/openclaw/media/inbound}"
LOG_FILE="$OUTPUT_DIR/suno-download-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$OUTPUT_DIR"

echo "🎵 Suno 批量下载脚本"
echo "===================="
echo "格式: $FORMAT"
echo "输出目录: $OUTPUT_DIR"
echo "日志文件: $LOG_FILE"
echo ""

# 1. 获取歌曲列表
echo "📋 正在获取歌曲列表..."
SONGS_JSON=$(opencli suno list --limit 100 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ 获取歌曲列表失败:"
    echo "$SONGS_JSON"
    exit 1
fi

# 提取歌曲数量
SONG_COUNT=$(echo "$SONGS_JSON" | grep -c 'id:' || echo "0")
echo "找到 $SONG_COUNT 首歌曲"
echo ""

# 2. 逐首下载
SUCCESS=0
FAILED=0

# 使用 jq 解析 JSON（如果可用），否则用 grep/sed 解析
if command -v jq > /dev/null 2>&1; then
    # 用 jq 精确解析
    IDS=($(echo "$SONGS_JSON" | jq -r '.[].id' 2>/dev/null || true))
    TITLES=($(echo "$SONGS_JSON" | jq -r '.[].title' 2>/dev/null || true))
    
    for i in "${!IDS[@]}"; do
        ID="${IDS[$i]}"
        TITLE="${TITLES[$i]}"
        
        echo "[$((i+1))/${#IDS[@]}] 下载: $TITLE ($ID)"
        
        if opencli suno download "$ID" --audio-format "$FORMAT" --output-dir "$OUTPUT_DIR" >> "$LOG_FILE" 2>&1; then
            echo "  ✅ 成功"
            SUCCESS=$((SUCCESS + 1))
        else
            echo "  ❌ 失败 (查看日志: $LOG_FILE)"
            FAILED=$((FAILED + 1))
        fi
        
        # 防止 rate limit，每次下载间隔 2 秒
        sleep 2
    done
else
    # 不用 jq，用 grep 粗略解析
    echo "$SONGS_JSON" | grep -E '^[0-9]+:' | while read -r line; do
        RANK=$(echo "$line" | grep -oP '^\d+')
        ID=$(echo "$line" | grep -oP '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
        TITLE=$(echo "$line" | sed 's/.*title: \([^|]*\).*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
        if [ -n "$ID" ]; then
            echo "[$RANK] 下载: $TITLE ($ID)"
            
            if opencli suno download "$ID" --audio-format "$FORMAT" --output-dir "$OUTPUT_DIR" >> "$LOG_FILE" 2>&1; then
                echo "  ✅ 成功"
                SUCCESS=$((SUCCESS + 1))
            else
                echo "  ❌ 失败"
                FAILED=$((FAILED + 1))
            fi
            
            sleep 2
        fi
    done
fi

echo ""
echo "===================="
echo "✅ 成功: $SUCCESS"
echo "❌ 失败: $FAILED"
echo "日志: $LOG_FILE"
echo "输出目录: $OUTPUT_DIR"
