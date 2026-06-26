#!/bin/bash

# Music Creator — OpenCLI environment setup script.
#
# New-architecture workflow (what this skill actually uses):
#   ocli suno generate  →  ocli suno download --formats wav --confirm-paid
#                       →  node scripts/publish-douyin.cjs
#
# This script only installs the douyin-music fallback adapter. It does NOT
# install the legacy suno adapters under adapters/suno/ — the official,
# CloakBrowser-patched OpenCLI suno adapters must stay in place (overwriting
# them breaks WAV downloads).

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; }

echo -e "${GREEN}Music Creator — Environment Setup${NC}"
echo "=========================================="
echo ""

# ── 1. Node.js ≥ 18 (OpenCLI runtime) ──
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

# ── 3. ocli wrapper (REQUIRED by this skill — every SKILL.md command uses it) ──
# ocli = opencli + on-demand CloakBrowser anti-detect routing. Without it the
# workflow lands on the desktop Chrome profile and Suno/Douyin logins won't stick.
CLI_CMD="opencli"
if command -v ocli &> /dev/null; then
    CLI_CMD="ocli"
    ok "ocli wrapper found ($CLI_CMD) — will use it for browser commands"
else
    err "ocli wrapper NOT found."
    echo "  Every command in SKILL.md is prefixed with 'ocli'. Without it, logins live"
    echo "  in the desktop Chrome profile (encrypted cookies, v11) and will NOT be reused,"
    echo "  so suno/douyin calls fail with AuthRequiredError."
    echo "  Install the ocli wrapper (opencli + CloakBrowser bridge) first."
    echo "  Continuing setup, but the skill will not work end-to-end without ocli."
    CLI_CMD="opencli"
fi

# ── 4. playwright-core (REQUIRED for scripts/publish-douyin.cjs) ──
# publish-douyin.cjs does: require('playwright-core'), with a fallback to the
# aily-browser skill's node_modules. Publishing is impossible without one of them.
if node -e "try{require('playwright-core')}catch(e){require(process.env.HOME+'/.openclaw/workspace/skills/aily-browser/scripts/node_modules/playwright-core')}" 2>/dev/null; then
    ok "playwright-core resolvable (publish-douyin.cjs ready)"
else
    err "playwright-core NOT found."
    echo "  scripts/publish-douyin.cjs requires playwright-core to drive the Douyin publish"
    echo "  form over CDP. Install one of:"
    echo "    npm install -g playwright-core"
    echo "    # or ensure the aily-browser skill with its node_modules is present"
    echo "  Without it, song generation/download still work, but publishing does NOT."
fi

# ── 5. CloakBrowser reachable on CDP 9222 (optional, runtime check) ──
CDP_URL="${CLOAK_CDP_URL:-http://127.0.0.1:9222}"
if curl -sf --max-time 2 "$CDP_URL/json/version" >/dev/null 2>&1; then
    ok "CloakBrowser reachable at $CDP_URL"
else
    warn "CloakBrowser not reachable at $CDP_URL (it auto-starts on first ocli call)."
    echo "  Log into suno.com and music.douyin.com inside CloakBrowser once; the session"
    echo "  persists in ~/.openclaw/chrome-profile/ across restarts."
fi

# ── 6. jq (optional, informational) ──
if command -v jq &> /dev/null; then
    ok "jq $(jq --version 2>/dev/null)"
else
    warn "jq not found (optional)."
fi

# ── 7. Determine target clis directory ──
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -d "$SCRIPT_DIR/adapters" ]; then
    err "adapters/ directory not found."
    echo "  Run this script from the music-creator repository root."
    exit 1
fi

# ── 8. Do NOT overwrite the official Suno adapter ──
# The official adapter shipped with OpenCLI is patched for CloakBrowser/curl and
# supports the current `suno generate` / `suno download` commands. The legacy
# custom adapters under adapters/suno/ are kept in the repo for reference only;
# replacing the official ones with them would break WAV downloads.
if [ -d "$TARGET_DIR/suno" ]; then
    echo ""
    warn "Keeping official Suno adapter in place ($TARGET_DIR/suno)."
    echo "  Legacy custom adapters in this repo's adapters/suno/ are NOT installed."
fi

# ── 9. Douyin Music adapter: install only if missing ──
if [ -d "$SCRIPT_DIR/adapters/douyin-music" ]; then
    echo ""
    mkdir -p "$TARGET_DIR/douyin-music"
    if [ -f "$TARGET_DIR/douyin-music/publish.js" ]; then
        warn "Douyin Music adapter already present; leaving existing file in place."
    else
        echo "Installing Douyin Music adapter..."
        cp "$SCRIPT_DIR/adapters/douyin-music/"*.js "$TARGET_DIR/douyin-music/"
        ok "Douyin Music adapter installed"
    fi
    warn "The adapter has known bugs. Use scripts/publish-douyin.cjs for stable publishing."
fi

# ── 10. Verify the commands this skill actually uses ──
echo ""
echo "Verifying current commands..."
FAIL=0
check_cmd() {
    local label="$1"; shift
    if $CLI_CMD "$@" --help >/dev/null 2>&1; then
        ok "$label"
    else
        warn "$label — not available"
        FAIL=1
    fi
}
check_cmd "suno generate"            suno generate
check_cmd "suno download"            suno download
check_cmd "suno list"                suno list
check_cmd "douyin-music publish"     douyin-music publish

# ── 11. Summary + next steps ──
echo ""
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
    ok "Setup complete!"
else
    warn "Setup finished, but some commands are unavailable (see above)."
fi
echo ""
echo "Before first use:"
echo "  1. Log into these sites inside CloakBrowser (sessions persist in"
echo "     ~/.openclaw/chrome-profile/; desktop Chrome logins do NOT carry over):"
echo "     - suno.com  (Premier subscription required to generate WAV)"
echo "     - music.douyin.com  (creator account required to publish)"
echo ""
echo "  2. Set timeout (Suno generation takes 3-7 min):"
echo "     export OPENCLI_BROWSER_COMMAND_TIMEOUT=600   # add to ~/.bashrc or ~/.zshrc"
echo ""
echo "  3. Smoke test:"
echo "     $CLI_CMD suno list --limit 5"
echo ""
echo "  4. Download WAV (Premier required):"
echo "     $CLI_CMD suno download <clip-id> --formats wav --confirm-paid --op ~/Music/"
echo ""
echo "See README.md and SKILL.md for the full workflow."
