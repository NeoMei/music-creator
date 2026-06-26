#!/bin/bash

# Music Creator — OpenCLI environment setup script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Music Creator — OpenCLI Environment Setup${NC}"
echo "=========================================="
echo ""

# Check if OpenCLI is installed
if ! command -v opencli &> /dev/null; then
    echo -e "${RED}Error: OpenCLI is not installed.${NC}"
    echo "Please install OpenCLI first:"
    echo "  npm install -g @jackwener/opencli"
    exit 1
fi

# Prefer ocli wrapper if available
CLI_CMD="opencli"
if command -v ocli &> /dev/null; then
    CLI_CMD="ocli"
    echo -e "${GREEN}✓ Found ocli wrapper; using it for browser commands${NC}"
fi

# Check OpenCLI version
OPENCLI_VERSION=$($CLI_CMD --version 2>/dev/null | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
if [ -z "$OPENCLI_VERSION" ]; then
    echo -e "${YELLOW}Warning: Could not determine OpenCLI version.${NC}"
else
    echo -e "${GREEN}✓ OpenCLI version: $OPENCLI_VERSION${NC}"
fi

# Determine target directory
if [ -n "$OPENCLI_HOME" ]; then
    TARGET_DIR="$OPENCLI_HOME/clis"
elif [ -d "$HOME/.opencli/clis" ]; then
    TARGET_DIR="$HOME/.opencli/clis"
else
    echo -e "${RED}Error: OpenCLI clis directory not found.${NC}"
    echo "Expected: ~/.opencli/clis/"
    exit 1
fi

echo "Target directory: $TARGET_DIR"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Do NOT overwrite the official Suno adapter. The official adapter is patched
# for CloakBrowser/curl and supports the current `suno generate` / `suno download`
# commands. Replacing it with the legacy custom adapters would break WAV downloads.
if [ -d "$TARGET_DIR/suno" ]; then
    echo ""
    echo -e "${YELLOW}Skipping Suno adapter install: official patched adapter already present.${NC}"
    echo "  ($TARGET_DIR/suno)"
fi

# Douyin Music adapter: install only if missing, but warn that the Node script is preferred
if [ -d "$SCRIPT_DIR/adapters/douyin-music" ]; then
    echo ""
    mkdir -p "$TARGET_DIR/douyin-music"
    if [ -f "$TARGET_DIR/douyin-music/publish.js" ]; then
        echo -e "${YELLOW}Douyin Music adapter already present; leaving existing file in place.${NC}"
    else
        echo "Installing Douyin Music adapter..."
        cp "$SCRIPT_DIR/adapters/douyin-music/"*.js "$TARGET_DIR/douyin-music/"
        echo -e "${GREEN}✓ Douyin Music adapter installed${NC}"
    fi
    echo -e "${YELLOW}Note: The adapter has known issues. Use scripts/publish-douyin.cjs for stable publishing.${NC}"
fi

# Verify current commands
echo ""
echo "Verifying current commands..."

if $CLI_CMD suno generate --help >/dev/null 2>&1; then
    echo -e "${GREEN}✓ suno generate — OK${NC}"
else
    echo -e "${YELLOW}⚠ suno generate — failed to load${NC}"
fi

if $CLI_CMD suno download --help >/dev/null 2>&1; then
    echo -e "${GREEN}✓ suno download — OK${NC}"
else
    echo -e "${YELLOW}⚠ suno download — failed to load${NC}"
fi

if $CLI_CMD suno list --help >/dev/null 2>&1; then
    echo -e "${GREEN}✓ suno list — OK${NC}"
else
    echo -e "${YELLOW}⚠ suno list — failed to load${NC}"
fi

if $CLI_CMD douyin-music publish --help >/dev/null 2>&1; then
    echo -e "${GREEN}✓ douyin-music publish — OK${NC}"
else
    echo -e "${YELLOW}⚠ douyin-music publish — failed to load${NC}"
fi

# Environment hints
echo ""
echo "=========================================="
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Important notes:"
echo "1. Use CloakBrowser for anti-detection automation."
echo "   Log into suno.com and music.douyin.com inside CloakBrowser once;"
echo "   session state persists across restarts."
echo ""
echo "2. Set environment variable (add to ~/.bashrc or ~/.zshrc):"
echo "   export OPENCLI_BROWSER_COMMAND_TIMEOUT=600"
echo ""
echo "3. Test with:"
echo "   $CLI_CMD suno generate --help"
echo "   $CLI_CMD suno download --help"
echo ""
echo "4. Download WAV with:"
echo "   $CLI_CMD suno download <clip-id> --formats wav --confirm-paid"
echo ""
echo "See README.md and SKILL.md for detailed usage."
