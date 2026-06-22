#!/usr/bin/env bash
# ============================================================
# start-server.sh
# Spustí lokální HTTP server pro DM Encounter Tracker a otevře
# aplikaci ve výchozím prohlížeči.
#
# Proč je server potřeba: některé funkce (Player View okno,
# import sample dat) vyžadují http:// origin, ne file://.
# Chování se liší prohlížeč od prohlížeče -- Firefox to vyžaduje
# vždy, Edge to ve většině případů tolerguje i bez serveru, ale
# server je spolehlivé řešení napříč všemi prohlížeči.
# ============================================================

set -e

PORT=8000

# Přejde do složky, ve které tento skript leží (tedy do root
# složky projektu), bez ohledu na to, odkud byl spuštěn.
cd "$(dirname "${BASH_SOURCE[0]}")"

# Najde dostupný Python -- python3 je standard na Linuxu a
# moderním macOS, python jako fallback pro starší/jiné systémy.
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
else
    echo ""
    echo "CHYBA: Python nebyl nalezen."
    echo "Nainstaluj Python 3 přes balíčkovací systém své distribuce"
    echo "(např. 'sudo apt install python3' na Ubuntu/Debian) nebo"
    echo "z https://www.python.org/downloads/ na macOS."
    echo ""
    exit 1
fi

echo ""
echo "Spouštím lokální server na portu $PORT..."
echo "Aplikace se otevře v prohlížeči za chvíli."
echo ""
echo "Pro zastavení serveru stiskni Ctrl+C."
echo ""

# Otevře prohlížeč po krátké prodlevě, ať server stihne naběhnout
# dřív, než se na něj prohlížeč pokusí připojit. Detekuje správný
# příkaz pro otevření URL podle operačního systému.
(
  sleep 1
  URL="http://localhost:$PORT/index.html"
  if command -v xdg-open &> /dev/null; then
    xdg-open "$URL" &> /dev/null
  elif command -v open &> /dev/null; then
    open "$URL"
  else
    echo "Otevři prohlížeč manuálně na: $URL"
  fi
) &

"$PYTHON_CMD" -m http.server "$PORT"
