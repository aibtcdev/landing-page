#!/usr/bin/env bash
#
# Manage the chainhook that feeds /legions: one Hiro Chainhooks 2.0 hook on
# mainnet, filtering `contract_log` prints from both El Salvador legion
# contracts and delivering them to POST /api/legions/chainhook.
#
# Modelled on news-legion's chainhook/register.sh. Same API, same auth:
#   host   https://api.hiro.so/chainhooks/me   (2.0 paths, NO /v1 prefix)
#   auth   x-api-key: $HIRO_API_KEY
#
# The consumer secret is ACCOUNT-WIDE (GET /chainhooks/me/secret). Hiro sends it
# on every delivery as x-chainhook-consumer-secret, and the destination URL also
# carries it as ?t=. The site must hold the same value as LEGION_CHAINHOOK_SECRET.
#
# Credentials come from a vars file (default .dev.vars) or the environment. The
# secret is read as LEGION_CHAINHOOK_SECRET, or CHAINHOOK_SECRET as news-legion
# names it, so news-legion's mainnet file works as-is:
#
#   VARS=~/repos/private/news-legion/.dev.vars.mainnet ./scripts/legion-chainhook.sh list
#
# HOOK=exchange runs every command below against the Legion Exchange hook
# (aibtc-legion-exchange-mainnet → /api/meta-legion/chainhook) instead:
#
#   HOOK=exchange ./scripts/legion-chainhook.sh create https://aibtc.com
#
#   create <base-url> [--enable]   register (DISABLED unless --enable)
#   list                           every hook on the account, secrets stripped
#   status                         this hook's state
#   enable | disable               toggle streaming
#   evaluate <stacks-block>        replay one block through the hook
#   delete                         remove this hook
#
# Register disabled until /api/legions/chainhook is deployed: deliveries to a
# route that does not exist yet fail, and Hiro interrupts a hook that keeps
# failing. Enable once the route is live, then `evaluate` any block that already
# carried a legion event (streaming only covers blocks after enable).
set -euo pipefail
cd "$(dirname "$0")/.."

VARS="${VARS:-.dev.vars}"
if [ -f "$VARS" ]; then
  eval "$(grep -E '^(HIRO_API_KEY|LEGION_CHAINHOOK_SECRET|CHAINHOOK_SECRET)=' "$VARS" || true)"
fi
SECRET="${LEGION_CHAINHOOK_SECRET:-${CHAINHOOK_SECRET:-}}"
: "${HIRO_API_KEY:?set HIRO_API_KEY (environment or \$VARS file)}"

# HOOK=exchange manages the second hook, which feeds /meta-legion from the
# Legion Exchange (EXCHANGE_CONTRACT in lib/meta-legion/constants.ts).
case "${HOOK:-legions}" in
  legions)
    # Keep in step with LEGION_CONTRACTS in lib/legion/constants.ts.
    CONTRACTS=(
      "SP5Y3W3F78NKFH4HYFNDQMJC484VZWKDH35ZR2M9.elsalvador-yes-legion-v2"
      "SP5Y3W3F78NKFH4HYFNDQMJC484VZWKDH35ZR2M9.elsalvador-no-legion-v2"
    )
    NAME="aibtc-legions-mainnet"
    ROUTE="/api/legions/chainhook"
    ;;
  exchange)
    CONTRACTS=("SP3ZXQV0BV07PH24ZWETHWM6MPQRHSYWPGAZAX2PR.legion-exchange")
    NAME="aibtc-legion-exchange-mainnet"
    ROUTE="/api/meta-legion/chainhook"
    ;;
  *)
    echo "HOOK must be legions or exchange" >&2
    exit 1
    ;;
esac
API="https://api.hiro.so/chainhooks/me"
HDR=(-H "x-api-key: ${HIRO_API_KEY}" -H "content-type: application/json")

# The list summary has name=null; the real name is under .definition.name.
hook_uuid() {
  curl -s "${HDR[@]}" "$API" \
    | jq -r --arg n "$NAME" '(.results // [])[] | select(.definition.name==$n) | .uuid' | head -1
}
need_uuid() {
  U="$(hook_uuid)"
  [ -n "$U" ] || { echo "no hook named '$NAME'" >&2; exit 1; }
}

case "${1:-}" in
  list)
    # The destination URL carries the secret in ?t=, so it is cut before printing.
    curl -s "${HDR[@]}" "$API" | jq '[(.results // [])[] | {
      uuid,
      name: .definition.name,
      enabled: .status.enabled,
      status: .status.status,
      contracts: [.definition.filters.events[]?.contract_identifier],
      url: ((.definition.action.url // "") | split("?")[0])
    }]'
    ;;
  status)
    need_uuid
    curl -s "${HDR[@]}" "$API/$U" | jq '{uuid, enabled: .status.enabled, status: .status.status, occurrences: .status.occurrence_count, last_block: .status.last_occurrence_block_height}'
    ;;
  enable|disable)
    need_uuid
    ON=false; [ "$1" = "enable" ] && ON=true
    curl -s -o /dev/null -w "$1 '$U' → HTTP %{http_code}\n" \
      -X PATCH "${HDR[@]}" "$API/$U/enabled" -d "{\"enabled\": $ON}"
    ;;
  evaluate)
    B="${2:?usage: evaluate <stacks_block_height>}"
    need_uuid
    echo "replaying block $B through '$NAME' ($U)…"
    curl -s -w "\nHTTP %{http_code}\n" -X POST "${HDR[@]}" "$API/$U/evaluate" \
      -d "{\"block_height\": $B}"
    ;;
  delete|rm)
    need_uuid
    echo "deleting '$NAME' ($U)…"
    # DELETE must not carry a content-type/body (Hiro 400s on an empty JSON body).
    curl -s -w "\nHTTP %{http_code}\n" -X DELETE -H "x-api-key: ${HIRO_API_KEY}" "$API/$U"
    ;;
  create)
    BASE="${2:?usage: create <public-base-url> [--enable]}"
    BASE="${BASE%/}"
    : "${SECRET:?set LEGION_CHAINHOOK_SECRET (or CHAINHOOK_SECRET)}"
    if [ -n "$(hook_uuid)" ]; then
      echo "'$NAME' already exists; delete it first or use enable/disable" >&2
      exit 1
    fi
    ENABLE=false; [ "${3:-}" = "--enable" ] && ENABLE=true
    URL="${BASE}${ROUTE}?t=${SECRET}"
    BODY="$(jq -n --arg name "$NAME" --arg url "$URL" --argjson enable "$ENABLE" --args '{
      name: $name,
      version: "1",
      chain: "stacks",
      network: "mainnet",
      filters: { events: [ $ARGS.positional[] | { type: "contract_log", contract_identifier: . } ] },
      action:  { type: "http_post", url: $url },
      options: { enable_on_registration: $enable }
    }' "${CONTRACTS[@]}")"
    echo "Creating chainhook '$NAME' → ${BASE}${ROUTE} (enabled: $ENABLE)"
    for c in "${CONTRACTS[@]}"; do echo "  watching: $c"; done
    RESP="$(curl -s -X POST "${HDR[@]}" "$API" -d "$BODY")"
    echo "$RESP" | jq '{uuid, name: .definition.name, enabled: .status.enabled, status: .status.status, error, message}' 2>/dev/null \
      || { echo "unexpected response from Hiro" >&2; exit 1; }
    ;;
  *)
    echo "usage: $0 create <base-url> [--enable] | list | status | enable | disable | evaluate <block> | delete" >&2
    exit 1
    ;;
esac
