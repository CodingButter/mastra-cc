#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
output=$(mktemp)
trap 'rm -f "$output"' EXIT
read -ra flags <<< "$(pkg-config --cflags --libs Qt6Core Qt6DBus Qt6Gui)"
g++ -std=c++20 -O2 -Wall -Wextra -Werror -fPIC test.cpp "${flags[@]}" -o "$output"
timeout -k 1 20 "$output"
