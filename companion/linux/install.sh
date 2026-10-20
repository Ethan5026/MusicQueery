#!/usr/bin/env bash
# MusicQueery companion on Linux (Ubuntu, x86-64): installs everything `mqc watch` needs as the current user.
# Safe to re-run. Needs once, with sudo: apt-get install -y build-essential pkg-config libpulse-dev
#   bash companion/linux/install.sh
# Then, once each (both open a login link):
#   ~/.cargo/bin/librespot --enable-oauth --cache ~/.cache/mqc-librespot ...   (printed below)
#   pnpm companion:linux login
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"
UV="$HOME/.local/bin/uv"
CARGO="$HOME/.cargo/bin/cargo"

for c in gcc g++ pkg-config pw-record; do
  command -v "$c" >/dev/null || { echo "Missing $c: sudo apt-get install -y build-essential pkg-config libpulse-dev pipewire-bin"; exit 1; }
done
pkg-config --exists libpulse || { echo "Missing libpulse-dev: sudo apt-get install -y libpulse-dev"; exit 1; }

echo "== Node for the theory bridge (fnm alias 'musicqueery' = .node-version, used by mqc-watch.service)"
FNM="$HOME/.local/share/fnm/fnm"
[ -x "$FNM" ] || { echo "Missing fnm: curl -fsSL https://fnm.vercel.app/install | bash"; exit 1; }
NODE_V="$(cat .node-version)"
"$FNM" install "$NODE_V"
"$FNM" alias "$NODE_V" musicqueery
NODE_BIN="$HOME/.local/share/fnm/aliases/musicqueery/bin"
[ -x "$NODE_BIN/pnpm" ] || PATH="$NODE_BIN:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$NODE_BIN/corepack" enable
PATH="$NODE_BIN:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$NODE_BIN/pnpm" install --frozen-lockfile

echo "== uv + Python 3.12"
[ -x "$UV" ] || curl -LsSf https://astral.sh/uv/install.sh | sh
"$UV" python install 3.12

echo "== Python packages (torch CPU, madmom, vamp, ...)"
"$UV" sync --project companion --frozen

echo "== Chordino (nnls-chroma.so)"
[ -f "${XDG_DATA_HOME:-$HOME/.local/share}/MusicQueery/vamp/nnls-chroma.so" ] \
  || "$UV" run --project companion --frozen python companion/scripts/build_chordino.py

echo "== librespot (Spotify Connect player for capture)"
[ -x "$CARGO" ] || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
[ -x "$HOME/.cargo/bin/librespot" ] || "$CARGO" install librespot --version 0.8.0 --locked \
  --no-default-features --features pulseaudio-backend,rustls-tls-webpki-roots

echo "== Silent capture sink + user services"
mkdir -p ~/.config/pipewire/pipewire.conf.d ~/.config/systemd/user
cp companion/linux/50-mqc-capture.conf ~/.config/pipewire/pipewire.conf.d/
cp companion/linux/mqc-librespot.service companion/linux/mqc-watch.service ~/.config/systemd/user/
sed -i "s|%h/repos/MusicQueery|$REPO|" ~/.config/systemd/user/mqc-watch.service
systemctl --user daemon-reload
systemctl --user restart pipewire pipewire-pulse wireplumber
loginctl enable-linger "$USER" 2>/dev/null || echo "Run once: sudo loginctl enable-linger $USER (services start at boot)"

cat <<EOF

Installed. Remaining one-time steps:
  1. librespot login (prints a link; approve it, then Ctrl+C once it says it is connected):
       ~/.cargo/bin/librespot --name "MusicQueery server" --backend pulseaudio --device mqc_capture \\
         --cache ~/.cache/mqc-librespot --disable-audio-cache --disable-discovery --enable-oauth
  2. Companion config + Spotify login: copy config.json to ~/.config/MusicQueery/companion/, then pnpm companion:linux login
  3. systemctl --user enable --now mqc-librespot mqc-watch
     journalctl --user -u mqc-watch -f
EOF
