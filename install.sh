#!/bin/bash

# Music Creator — OpenCLI Adapters 安装脚本
# 把 suno / douyin-music adapter 装进 opencli 的 clis 目录。

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; }

echo -e "${GREEN}Music Creator — OpenCLI Adapters Installer${NC}"
echo "=========================================="
echo ""

# ── 1. Node.js ≥ 18 ──
if ! command -v node &> /dev/null; then
    err "Node.js is not installed."
    echo "  Install from https://nodejs.org/ (≥ 18 required)."
    exit 1
fi
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/')
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ]; then
    err "Node.js ≥ 18 required, got $(node -v 2>/dev/null || 'unknown')."
    exit 1
fi
ok "Node.js $(node -v)"

# ── 2. OpenCLI ──
if ! command -v opencli &> /dev/null; then
    err "OpenCLI is not installed."
    echo "  Install first:  npm install -g @jackwener/opencli"
    exit 1
fi
OPENCLI_VERSION=$(opencli --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -z "$OPENCLI_VERSION" ]; then
    warn "Could not determine OpenCLI version (continuing anyway)."
else
    ok "OpenCLI $OPENCLI_VERSION"
fi

# ── 3. Chrome (opencli drives it in headed mode) ──
if command -v google-chrome &> /dev/null \
   || command -v google-chrome-stable &> /dev/null \
   || command -v chromium &> /dev/null \
   || command -v chromium-browser &> /dev/null \
   || [ -d "/Applications/Google Chrome.app" ]; then
    ok "Google Chrome found"
else
    warn "Google Chrome not detected in PATH."
    echo "  opencli drives Chrome in headed mode — install it from https://www.google.com/chrome/"
    echo "  (continuing install, but runtime commands will fail without Chrome)"
fi

# ── 4. jq (optional, used by suno-batch-download.sh) ──
if command -v jq &> /dev/null; then
    ok "jq $(jq --version 2>/dev/null)"
else
    warn "jq not found — suno-batch-download.sh will fall back to grep parsing."
    echo "  Recommended:  macOS 'brew install jq'  /  Debian 'sudo apt install jq'"
fi

# ── 5. Determine target clis directory ──
if [ -n "$OPENCLI_HOME" ]; then
    TARGET_DIR="$OPENCLI_HOME/clis"
elif [ -d "$HOME/.opencli/clis" ]; then
    TARGET_DIR="$HOME/.opencli/clis"
else
    err "OpenCLI clis directory not found."
    echo "  Expected: ~/.opencli/clis/  (run 'opencli doctor' to diagnose)"
    exit 1
fi
echo ""
echo -e "${BLUE}Target:${NC} $TARGET_DIR"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$SCRIPT_DIR/adapters" ]; then
    err "adapters/ directory not found."
    echo "  Run this script from the music-creator repository root."
    exit 1
fi

mkdir -p "$TARGET_DIR/suno" "$TARGET_DIR/douyin-music"

# ── 6. Backup any pre-existing files that would be overwritten ──
# music-creator ships its own suno/download.js and list.js, which share names
# with the adapters bundled inside OpenCLI itself. Back up the originals so the
# install is reversible.
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$TARGET_DIR/suno/.backup-pre-music-creator-$TS"
OVERWRITTEN=""
for src in "$SCRIPT_DIR/adapters/suno/"*.js; do
    [ -f "$src" ] || continue
    name="$(basename "$src")"
    dest="$TARGET_DIR/suno/$name"
    if [ -f "$dest" ]; then
        [ -d "$BACKUP_DIR" ] || mkdir -p "$BACKUP_DIR"
        cp "$dest" "$BACKUP_DIR/"
        OVERWRITTEN="$OVERWRITTEN $name"
    fi
done

# ── 7. Copy adapters ──
echo ""
echo "Installing Suno adapters..."
cp "$SCRIPT_DIR/adapters/suno/"*.js "$TARGET_DIR/suno/"
ok "Suno adapters installed"

echo ""
echo "Installing Douyin Music adapters..."
cp "$SCRIPT_DIR/adapters/douyin-music/"*.js "$TARGET_DIR/douyin-music/"
ok "Douyin Music adapters installed"

if [ -n "$OVERWRITTEN" ]; then
    echo ""
    warn "Overwrote existing adapter(s):$OVERWRITTEN"
    echo "  Backed up to: $BACKUP_DIR"
    echo "  Restore with:  cp \"$BACKUP_DIR\"/*.js \"$TARGET_DIR/suno/\""
fi

# ── 8. Verify adapters load ──
echo ""
echo "Verifying installation..."
FAIL=0
check_cmd() {
    local label="$1"; shift
    if opencli "$@" --help >/dev/null 2>&1; then
        ok "$label"
    else
        warn "$label — failed to load"
        FAIL=1
    fi
}
check_cmd "suno create-advanced"  suno create-advanced
check_cmd "suno generate-wav"     suno generate-wav
check_cmd "suno download"         suno download
check_cmd "suno list"             suno list
check_cmd "douyin-music publish"  douyin-music publish

# ── 9. Next steps ──
echo ""
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
    ok "Installation complete!"
else
    warn "Installation finished, but some adapters failed to load."
    echo "  Run 'opencli doctor' to diagnose."
fi
echo ""
echo "Before first use:"
echo "  1. Log in to these sites in Chrome (opencli reuses your default profile):"
echo "     - suno.com  (Premier subscription required to generate WAV)"
echo "     - music.douyin.com  (creator account required to publish)"
echo ""
echo "  2. Set timeout (Suno generation takes 3-7 min):"
echo "     export OPENCLI_BROWSER_COMMAND_TIMEOUT=600"
echo "     # add to ~/.bashrc or ~/.zshrc to persist"
echo ""
echo "  3. Smoke test:"
echo "     opencli suno list --limit 5"
echo ""
echo "See README.md for the full workflow."
