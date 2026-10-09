#!/usr/bin/env bash
# Installs (or updates) Cerberus from the latest GitHub release and starts it. Linux x86_64.
#
#   ./scripts/play-linux.sh               .deb via apt on Debian/Ubuntu (asks for sudo), portable build elsewhere
#   ./scripts/play-linux.sh --portable    portable build in ~/.local/share/cerberus, no sudo, no FUSE
#   ./scripts/play-linux.sh --no-launch   install / update only
#   ./scripts/play-linux.sh -- --debug    everything after -- goes to the game
#
# One-liner (from a branch that has this script):
#   curl -fsSL https://raw.githubusercontent.com/NicolaLC/CerberusProject/main/scripts/play-linux.sh | bash
set -euo pipefail

REPO="NicolaLC/CerberusProject"
PORTABLE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/cerberus"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

portable=0
launch=1
game_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --portable) portable=1 ;;
    --no-launch) launch=0 ;;
    -h|--help) echo "usage: play-linux.sh [--portable] [--no-launch] [-- game args]"; exit 0 ;;
    --) shift; game_args=("$@"); break ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1;36m[cerberus]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[cerberus]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Linux ]] || die "this script is for Linux"
[[ "$(uname -m)" == x86_64 ]] || die "only x86_64 builds are published (this machine: $(uname -m))"
command -v curl >/dev/null || die "curl is required"

# Newest release, prereleases included (/releases/latest skips them).
latest=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" | grep -o '"tag_name": *"v[^"]*"' | head -1 | sed 's/.*"v\([^"]*\)"/\1/') || true
[[ -n "${latest:-}" ]] || die "could not read the latest release from GitHub"
url="https://github.com/$REPO/releases/download/v$latest"
say "latest release: v$latest"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fetch() { say "downloading $1"; curl -fL --progress-bar -o "$tmp/$1" "$url/$1"; }

# Chromium's sandbox needs unprivileged user namespaces (blocked by AppArmor on Ubuntu 24.04+)
# or a root-owned SUID helper, which only the .deb can install. Portable builds fall back to --no-sandbox.
sandbox_args() {
  if unshare --user true 2>/dev/null; then return; fi
  local helper="$1/chrome-sandbox"
  if [[ -u "$helper" && "$(stat -c %u "$helper")" == 0 ]]; then return; fi
  echo --no-sandbox
}

# Debian / Ubuntu: .deb (menu entry, `cerberus` command, sandbox + AppArmor profile set up by the package).
# Returns non-zero when apt can't install it (e.g. missing dependencies); the caller falls back to portable.
install_deb() {
  local installed file sudo=""
  installed=$(dpkg-query -W -f='${Version}' cerberus 2>/dev/null || true)
  if [[ "$installed" == "$latest" ]]; then
    say "v$latest already installed"
    return 0
  fi
  file="Cerberus-$latest-linux-amd64.deb"
  fetch "$file"
  say "installing $file${installed:+ (replacing v$installed)} — sudo may ask for your password"
  [[ $EUID -ne 0 ]] && sudo="sudo"
  # </dev/null: stdin may be this script (curl | bash)
  $sudo apt-get install -y "$tmp/$file" </dev/null && return 0
  say "apt could not install it: refreshing package lists and retrying"
  $sudo apt-get update </dev/null && $sudo apt-get install -y "$tmp/$file" </dev/null
}

if [[ $portable == 0 ]] && command -v dpkg >/dev/null && command -v apt-get >/dev/null; then
  if install_deb; then
    exe=/opt/Cerberus/cerberus
    flags=()
  else
    say "the .deb could not be installed: using the portable build instead"
    portable=1
  fi
else
  portable=1
fi

if [[ $portable == 1 ]]; then
  # ---- any distro: portable tar.gz under ~/.local/share/cerberus/<version>, launcher in ~/.local/bin
  dir="$PORTABLE_DIR/$latest"
  if [[ -x "$dir/cerberus" ]]; then
    say "v$latest already installed in $dir"
  else
    file="Cerberus-$latest-linux-x64.tar.gz"
    fetch "$file"
    mkdir -p "$dir"
    tar -xzf "$tmp/$file" -C "$dir" --strip-components=1
    # keep only this version
    find "$PORTABLE_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "$latest" -exec rm -rf {} +
    say "installed in $dir"
  fi
  exe="$dir/cerberus"
  read -r -a flags <<< "$(sandbox_args "$dir")"
  mkdir -p "$BIN_DIR" "$APPS_DIR"
  cat > "$BIN_DIR/cerberus" <<EOF
#!/usr/bin/env bash
exec "$exe" ${flags[*]:-} "\$@"
EOF
  chmod +x "$BIN_DIR/cerberus"
  cat > "$APPS_DIR/cerberus.desktop" <<EOF
[Desktop Entry]
Name=Cerberus
Comment=Third-person sci-fi cover shooter
Exec=$BIN_DIR/cerberus
Terminal=false
Type=Application
Categories=Game;
EOF
  say "launcher: $BIN_DIR/cerberus (and a Cerberus entry in the app menu)"
  if [[ ${#flags[@]} -gt 0 ]]; then say "this system blocks Chromium's sandbox for portable apps: starting with --no-sandbox"; fi
fi

if [[ $launch == 1 ]]; then
  say "starting Cerberus"
  nohup "$exe" "${flags[@]}" "${game_args[@]}" </dev/null >/dev/null 2>&1 &
  disown
fi
