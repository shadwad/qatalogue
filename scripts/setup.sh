#!/bin/bash
# Set up .venv, node_modules, and .env.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -t 1 ]; then BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'; else BLUE=''; GREEN=''; RED=''; NC=''; fi
step() { echo -e "${BLUE}$1${NC}"; }
fail() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }

step "Checking system requirements..."
# Match .python-version so pip installs prebuilt wheels for pipeline/requirements.lock.
PY_VERSION="$(tr -d '[:space:]' < .python-version)"
py_version_of() { "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true; }
PYTHON=""
for candidate in "python$PY_VERSION" python3; do
  if command -v "$candidate" >/dev/null && [ "$(py_version_of "$candidate")" = "$PY_VERSION" ]; then
    PYTHON="$candidate"; break
  fi
done
[ -n "$PYTHON" ] || fail "Python $PY_VERSION required (see .python-version); found $(python3 --version 2>&1 || echo 'none')."
NODE_MAJOR="$(tr -d '[:space:]' < .nvmrc)"
command -v node >/dev/null && command -v npm >/dev/null || fail "node and npm not found. Install Node $NODE_MAJOR (see .nvmrc)."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= Number(process.argv[1]) ? 0 : 1)' "$NODE_MAJOR" \
  || fail "Node $NODE_MAJOR+ required (see .nvmrc); found $(node --version)."
echo -e "${GREEN}✓ Python $("$PYTHON" -V | cut -d' ' -f2) ($PYTHON), Node $(node -v), npm $(npm -v)${NC}\n"

step "Python environment (.venv, from pipeline/requirements.lock)..."
if [ -d .venv ] && [ -x ./.venv/bin/pip ]; then
  VENV_VERSION="$(py_version_of ./.venv/bin/python3)"
  [ "$VENV_VERSION" = "$PY_VERSION" ] \
    || fail ".venv was made with Python ${VENV_VERSION:-unknown}, not $PY_VERSION. Remove it ('rm -rf .venv') and run this again."
else
  rm -rf .venv
  "$PYTHON" -m venv .venv
fi
./.venv/bin/pip install -q -r pipeline/requirements.lock
echo -e "${GREEN}✓ $(./.venv/bin/pip freeze --exclude pip | wc -l | tr -d ' ') packages installed at the locked versions${NC}\n"

step "Node packages (from package-lock.json)..."
# Skip optional CUDA runtime download (embeddings run on CPU).
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --no-audit --no-fund
echo -e "${GREEN}✓ Node packages installed${NC}\n"

step "Configuration (.env)..."
if [ -f .env ]; then
  echo -e "${GREEN}✓ .env exists${NC}\n"
else
  cp .env.example .env
  chmod 600 .env
  echo -e "${GREEN}✓ .env created from .env.example: set POLITE_POOL_EMAIL, and an OpenAlex key (OPENALEX_API_KEY_ENABLED=true) for a full fetch${NC}\n"
fi

echo -e "${GREEN}Setup complete.${NC}"
echo "  make test   run test suites"
echo "  make all    build data/serve.db from pipeline/config/scope.json"
echo "  npm run dev start development server"
