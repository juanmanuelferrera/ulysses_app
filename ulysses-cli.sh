#!/bin/bash
# ulysses-cli.sh — CLI for Ulysses app (API-based, R2-first)
API="https://ulysses-app.pages.dev/api"
TOKEN_FILE="$(dirname "$0")/.ulysses-token"

# Load saved token
TOKEN=""
if [ -f "$TOKEN_FILE" ]; then TOKEN=$(cat "$TOKEN_FILE"); fi

call() {
  local method="$1" path="$2" data="$3"
  if [ -z "$TOKEN" ]; then echo "Not logged in. Run: ./ulysses-cli.sh login"; exit 1; fi
  local args=(-s -X "$method" "$API$path" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  if [ -n "$data" ]; then args+=(-d "$data"); fi
  local res=$(curl "${args[@]}")
  if echo "$res" | grep -q '"error":"Unauthorized"'; then
    echo "Session expired. Run: ./ulysses-cli.sh login"
    exit 1
  fi
  echo "$res"
}

# Find group ID by name
find_group() {
  call GET "/groups" | python3 -c "
import sys,json
groups=json.load(sys.stdin)
for g in groups:
  if g['name']=='$1': print(g['id']); sys.exit()
print('')" 2>/dev/null
}

# Find sheet ID by title
find_sheet() {
  call GET "/sheets/search?q=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$1'))")" | python3 -c "
import sys,json
sheets=json.load(sys.stdin)
for s in sheets:
  if s['title']=='$1': print(s['id']); sys.exit()
print('')" 2>/dev/null
}

case "$1" in
  login)
    # Usage: ./ulysses-cli.sh login
    read -sp "Password: " PASS; echo
    RES=$(curl -s -X POST "$API/auth" -H "Content-Type: application/json" -d "{\"token\":\"$PASS\"}")
    SESSION=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin).get('session',''))" 2>/dev/null)
    if [ -n "$SESSION" ] && [ "$SESSION" != "None" ]; then
      echo "$SESSION" > "$TOKEN_FILE"
      chmod 600 "$TOKEN_FILE"
      echo "Logged in."
    else
      echo "Login failed."
    fi
    ;;
  sheet)
    # Usage: ./ulysses-cli.sh sheet "Group Name" "Title" "Content"
    GID=$(find_group "$2")
    if [ -z "$GID" ]; then echo "Group '$2' not found"; exit 1; fi
    CONTENT="${4:-# $3}"
    call POST "/sheets" "{\"groupId\":\"$GID\",\"title\":\"$3\",\"content\":\"$CONTENT\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Created '{d.get(\"title\",\"\")}' (id: {d.get(\"id\",\"\")})\")" 2>/dev/null
    ;;
  group)
    # Usage: ./ulysses-cli.sh group "Name"
    call POST "/groups" "{\"name\":\"$2\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Created group '{d.get(\"name\",\"\")}' (id: {d.get(\"id\",\"\")})\")" 2>/dev/null
    ;;
  project)
    # Usage: ./ulysses-cli.sh project "Name"
    call POST "/groups" "{\"name\":\"$2\",\"section\":\"projects\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Created project '{d.get(\"name\",\"\")}' (id: {d.get(\"id\",\"\")})\")" 2>/dev/null
    ;;
  tag)
    # Usage: ./ulysses-cli.sh tag "Name" "#color"
    COLOR="${3:-#FF9500}"
    call POST "/tags" "{\"name\":\"$2\",\"color\":\"$COLOR\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Created tag '{d.get(\"name\",\"\")}' (id: {d.get(\"id\",\"\")})\")" 2>/dev/null
    ;;
  delete-sheet)
    # Usage: ./ulysses-cli.sh delete-sheet "Title"
    SID=$(find_sheet "$2")
    if [ -z "$SID" ]; then echo "Sheet '$2' not found"; exit 1; fi
    call DELETE "/sheets/$SID" > /dev/null
    echo "Deleted sheet '$2'"
    ;;
  delete-group)
    # Usage: ./ulysses-cli.sh delete-group "Name"
    GID=$(find_group "$2")
    if [ -z "$GID" ]; then echo "Group '$2' not found"; exit 1; fi
    call DELETE "/groups/$GID" > /dev/null
    echo "Deleted group '$2'"
    ;;
  edit-sheet)
    # Usage: ./ulysses-cli.sh edit-sheet "Title" "New content"
    SID=$(find_sheet "$2")
    if [ -z "$SID" ]; then echo "Sheet '$2' not found"; exit 1; fi
    call PUT "/sheets/$SID" "{\"content\":\"$3\",\"title\":\"$2\"}" > /dev/null
    echo "Updated sheet '$2'"
    ;;
  list-groups)
    call GET "/groups" | python3 -c "
import sys,json
for g in json.load(sys.stdin):
  cnt=g.get('sheetCount',0)
  print(f\"  {g['name']} ({cnt})\")" 2>/dev/null
    ;;
  list-sheets)
    # Usage: ./ulysses-cli.sh list-sheets "Group Name"
    GID=$(find_group "$2")
    if [ -z "$GID" ]; then echo "Group '$2' not found"; exit 1; fi
    call GET "/sheets?groupId=$GID" | python3 -c "
import sys,json
for s in json.load(sys.stdin):
  fav='*' if s.get('favorite') else ' '
  print(f\" {fav} {s['title']}\")" 2>/dev/null
    ;;
  sync)
    # Usage: ./ulysses-cli.sh sync
    call POST "/r2/sync" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Pushed: {d.get('pushed',0)}, Pulled: {d.get('pulled',0)}, Created: {d.get('created',0)}\")" 2>/dev/null
    ;;
  push)
    call POST "/r2/push" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Pushed: {d.get('pushed',0)}, Deleted: {d.get('deleted',0)}\")" 2>/dev/null
    ;;
  pull)
    call POST "/r2/pull" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"Pulled: {d.get('pulled',0)}, Created: {d.get('created',0)}\")" 2>/dev/null
    ;;
  *)
    echo "Usage: ulysses-cli.sh {login|sheet|group|tag|delete-sheet|delete-group|edit-sheet|list-groups|list-sheets|sync|push|pull}"
    echo ""
    echo "  login                                Authenticate"
    echo "  sheet \"Group\" \"Title\" \"Content\"       Create a sheet"
    echo "  group \"Name\"                         Create a group (Notes)"
    echo "  project \"Name\"                       Create a project"
    echo "  tag \"Name\" \"#color\"                  Create a tag"
    echo "  delete-sheet \"Title\"                  Delete a sheet"
    echo "  delete-group \"Name\"                   Delete a group"
    echo "  edit-sheet \"Title\" \"New content\"      Edit a sheet"
    echo "  list-groups                           List all groups"
    echo "  list-sheets \"Group\"                   List sheets in group"
    echo "  sync                                  Bidirectional R2 sync"
    echo "  push                                  Push D1 -> R2"
    echo "  pull                                  Pull R2 -> D1"
    ;;
esac
