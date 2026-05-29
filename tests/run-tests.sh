#!/usr/bin/env bash
# Run all tests. Use flags to select specific test suites.
#
# Usage:
#   ./tests/run-tests.sh          # All offline tests (core, merchant, notebook)
#   ./tests/run-tests.sh --all    # All tests including integration + E2E
#   ./tests/run-tests.sh --core   # Core unit tests only
#   ./tests/run-tests.sh --merchant  # Merchant Lambda tests only
#   ./tests/run-tests.sh --agent  # Agent integration tests (needs .env)
#   ./tests/run-tests.sh --ui     # UI E2E tests (needs servers running)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Determine which tests to run
if [[ "${1:-}" == "--all" ]]; then
  SUITES="core merchant notebook agent ui"
elif [[ "${1:-}" == "--core" ]]; then
  SUITES="core"
elif [[ "${1:-}" == "--merchant" ]]; then
  SUITES="merchant"
elif [[ "${1:-}" == "--agent" ]]; then
  SUITES="agent"
elif [[ "${1:-}" == "--ui" ]]; then
  SUITES="ui"
elif [[ "${1:-}" == "--notebook" ]]; then
  SUITES="notebook"
else
  # Default: offline tests only
  SUITES="core merchant notebook"
fi

FAILED=0

for suite in $SUITES; do
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  Running: tests/$suite/"
  echo "═══════════════════════════════════════════════"
  if python -m pytest "tests/$suite/" -v --tb=short 2>&1; then
    echo "  ✅ $suite passed"
  else
    echo "  ❌ $suite FAILED"
    FAILED=1
  fi
done

echo ""
echo "═══════════════════════════════════════════════"
if [[ $FAILED -eq 0 ]]; then
  echo "  ✅ All test suites passed!"
else
  echo "  ❌ Some tests failed"
  exit 1
fi
