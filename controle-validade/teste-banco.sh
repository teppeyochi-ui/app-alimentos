#!/usr/bin/env bash
# Testa o banco da nuvem (supabase/instalar.sql) num PostgreSQL temporário: não toca em nenhum banco existente.
#   bash teste-banco.sh
# Precisa do PostgreSQL 15+ instalado (initdb, pg_ctl, psql).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)

if ! command -v initdb >/dev/null 2>&1; then
  PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
  [ -n "${PGBIN:-}" ] && PATH="$PGBIN:$PATH"
fi
command -v initdb >/dev/null 2>&1 || { echo "PostgreSQL não encontrado (initdb)."; exit 2; }

TMP=$(mktemp -d)
PORTA=$((20000 + RANDOM % 20000))
# O servidor não roda como root: nesse caso usa o usuário postgres do sistema.
COMO=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$TMP"
  COMO=(runuser -u postgres --)
fi

parar() { "${COMO[@]}" pg_ctl -D "$TMP/dados" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap parar EXIT

"${COMO[@]}" initdb -D "$TMP/dados" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
"${COMO[@]}" pg_ctl -D "$TMP/dados" -o "-p $PORTA -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
SQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORTA" -U postgres -d postgres)

"${SQL[@]}" -f "$AQUI/supabase/teste/imitar-supabase.sql"
"${SQL[@]}" -f "$AQUI/supabase/instalar.sql"
# O instalador pode ser rodado de novo sem estragar nada.
"${SQL[@]}" -f "$AQUI/supabase/instalar.sql"
"${SQL[@]}" -t -A -f "$AQUI/supabase/teste/testes.sql" | grep -v '^$'
# E de novo com dados dentro: continua tudo lá.
ANTES=$("${SQL[@]}" -t -A -c "select count(*) from public.vd_registros")
"${SQL[@]}" -f "$AQUI/supabase/instalar.sql"
DEPOIS=$("${SQL[@]}" -t -A -c "select count(*) from public.vd_registros")
[ "$ANTES" = "$DEPOIS" ] && [ "$ANTES" -gt 250 ] || { echo "reinstalar mudou os dados: $ANTES -> $DEPOIS"; exit 1; }
echo "banco: reinstalar com dados não apaga nada ($DEPOIS linhas)"
