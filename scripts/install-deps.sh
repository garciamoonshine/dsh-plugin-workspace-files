#!/usr/bin/env bash
set -e

echo "=== Installing dependencies for dsh-plugin-workspace-files ==="

# 1. Install poppler-utils (pdftotext, pdftoppm)
if ! command -v pdftotext &>/dev/null; then
  echo "Installing poppler-utils..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -y && sudo apt-get install -y poppler-utils
  elif command -v yum &>/dev/null; then
    sudo yum install -y poppler-utils
  elif command -v brew &>/dev/null; then
    brew install poppler
  else
    echo "Warning: package manager not recognized. Please install poppler-utils manually."
  fi
else
  echo "✓ poppler-utils already installed."
fi

# 2. Ensure pnpm is available (required by 'dsh plugin')
if ! command -v pnpm &>/dev/null; then
  echo "Ensuring pnpm is available for dsh plugin..."
  if command -v corepack &>/dev/null; then
    corepack enable pnpm
    echo "✓ Enabled pnpm via corepack."
  elif command -v npm &>/dev/null; then
    npm install -g pnpm
    echo "✓ Installed pnpm via npm."
  else
    echo "Warning: neither corepack nor npm found. Please install pnpm manually."
  fi
else
  echo "✓ pnpm already available."
fi

# 3. File Browser binary (optional - the plugin includes a built-in Mac Finder manager on DSH port 3080)
if ! command -v filebrowser &>/dev/null; then
  echo "Optional: File Browser standalone binary is not installed."
  echo "The plugin will use its built-in Mac Finder file manager directly on DSH port 3080 (no port 8080/8088 needed)."
else
  echo "✓ filebrowser binary available (optional proxy mode supported)."
fi

echo "=== Setup complete ==="
