#!/usr/bin/env bash
# Testa as migrações, a carga inicial e as políticas de acesso num PostgreSQL
# temporário (não toca em nenhum banco existente).
#   bash testes/sql/rodar.sh                 migrações + carga
#   bash testes/sql/rodar.sh --instalador    supabase/instalar.sql
#   bash testes/sql/rodar.sh --atualizacao   instalador da primeira versão + supabase/atualizar.sql
# Precisa do PostgreSQL 15+ instalado (initdb, pg_ctl, psql).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)

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

SQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORTA" -U postgres -d postgres)

echo "Preparando o banco (migrações + carga inicial)"
"${SQL[@]}" -f "$AQUI/supabase-local.sql"
if [ "${1:-}" = "--instalador" ]; then
  # Testa o arquivo único que o README manda colar no SQL Editor.
  "${SQL[@]}" -f "$RAIZ/supabase/instalar.sql"
elif [ "${1:-}" = "--atualizacao" ]; then
  # Banco criado com a primeira versão do instalador (commit ae82a46) e depois
  # atualizado com supabase/atualizar.sql, rodado duas vezes.
  git -C "$RAIZ" show ae82a46:diario-skin/supabase/instalar.sql > "$TMP/instalar-v1.sql"
  chmod a+r "$TMP/instalar-v1.sql"
  "${SQL[@]}" -f "$TMP/instalar-v1.sql"
  "${SQL[@]}" -f "$RAIZ/supabase/atualizar.sql" >/dev/null
  "${SQL[@]}" -f "$RAIZ/supabase/atualizar.sql" >/dev/null
else
  for f in "$RAIZ"/supabase/migrations/*.sql; do "${SQL[@]}" -f "$f"; done
  "${SQL[@]}" -f "$RAIZ/supabase/seed.sql"
fi

"${SQL[@]}" -f "$AQUI/testes.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE: //' -e 's/^NOTICE: //'

# A carga pode ser repetida: não duplica nem desfaz o que foi corrigido.
"${SQL[@]}" -f "$RAIZ/supabase/seed.sql"
FINAL=$("${SQL[@]}" -At <<'FIM'
select case when (select count(*) from public.produtos) = 119 then '✓' else '✗' end || ' produtos continuam 119 (118 + 1 incluído no teste)';
select case when (select count(*) from public.ops where origem = 'planilha') = 15 then '✓' else '✗' end || ' histórico continua com 15';
select case when (select count(*) from public.receitas_padrao) = 2 then '✓' else '✗' end || ' receitas continuam 2';
select case when (select molde from public.ops where id = '00000000-0000-4000-8000-000000000009') = '3x1' then '✓' else '✗' end || ' correção do P&D no histórico foi mantida';
select case when (select embalagens_por_caixa from public.produtos where codigo = '24616701063781-975') = 9 then '✓' else '✗' end || ' embalagens por caixa do catálogo foi mantida';
FIM
)
echo "$FINAL" | sed 's/^/  /'
if echo "$FINAL" | grep -q '✗'; then echo "Banco: a carga repetida alterou dados."; exit 1; fi

echo "Banco: todos os testes passaram."
