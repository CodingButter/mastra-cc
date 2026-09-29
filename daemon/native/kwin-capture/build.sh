#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $# == 1 && "$1" == /* ]] || { echo 'usage: build.sh /absolute/output' >&2; exit 2; }
read -ra flags <<< "$(pkg-config --cflags --libs Qt6Core Qt6DBus Qt6Gui)"
g++ -std=c++20 -O2 -Wall -Wextra -Werror -fPIC main.cpp "${flags[@]}" -o "$1"
