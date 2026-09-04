#!/usr/bin/env bash
set -e

REPO="nouverse/nouclip"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="nouclip"

# Detect OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)
    case "$ARCH" in
      x86_64) ASSET="nouclip-linux-x64" ;;
      *) echo "❌ Unsupported Linux architecture: $ARCH (only x86_64 supported)"; exit 1 ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      arm64|aarch64) ASSET="nouclip-darwin-arm64" ;;
      x86_64) ASSET="nouclip-darwin-x64" ;;
      *) echo "❌ Unsupported macOS architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "❌ Unsupported OS: $OS. On Windows, please download nouclip-windows-x64.exe directly."
    exit 1
    ;;
esac

echo "🚀 Downloading NouClip (${ASSET})..."
LATEST_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

TMP_FILE="$(mktemp)"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$LATEST_URL" -o "$TMP_FILE"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_FILE" "$LATEST_URL"
else
  echo "❌ Error: curl or wget is required."
  exit 1
fi

chmod +x "$TMP_FILE"

# Install binary to /usr/local/bin
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_FILE" "${INSTALL_DIR}/${BIN_NAME}"
else
  echo "🔒 Elevating permissions to install to ${INSTALL_DIR}/${BIN_NAME}..."
  sudo mv "$TMP_FILE" "${INSTALL_DIR}/${BIN_NAME}"
fi

echo "✅ NouClip installed successfully to ${INSTALL_DIR}/${BIN_NAME}!"
echo "👉 Run 'nouclip --help' to get started."
