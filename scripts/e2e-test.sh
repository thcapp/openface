#!/bin/bash
# End-to-end test: claim face → push states → verify
set -e

echo "=== E2E Agent Test ==="
echo ""

# 1. Claim a test face
echo "1. Claiming test face..."
CLAIM=$(curl -s -X POST https://oface.io/api/claim \
  -H "Content-Type: application/json" \
  -d '{"username":"e2e-test-'$RANDOM'","face":"default"}')
echo "$CLAIM" | python3 -m json.tool

USERNAME=$(echo "$CLAIM" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])")
API_KEY=$(echo "$CLAIM" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
echo "  Username: $USERNAME"
echo "  API Key: ${API_KEY:0:20}..."
echo ""

# 2. Push state: thinking
echo "2. Push state: thinking + determined..."
curl -s -X POST "https://oface.io/$USERNAME/api/state" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"thinking","emotion":"determined"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', d.get('ok'), 'State:', d.get('state',{}).get('state'))"

# 3. Push state: working
echo "3. Push state: working..."
curl -s -X POST "https://oface.io/$USERNAME/api/state" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"working","emotion":"neutral"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', d.get('ok'), 'State:', d.get('state',{}).get('state'))"

# 4. Push state: speaking with text
echo "4. Push speaking with text..."
curl -s -X POST "https://oface.io/$USERNAME/api/speak" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from the E2E test!","emotion":"happy"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', d.get('ok'), 'Seq:', d.get('seq'), 'State:', d.get('state',{}).get('state'))"

# 5. Read state back
echo "5. Read state (GET)..."
curl -s "https://oface.io/$USERNAME/api/state" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  State:', d.get('state'), 'Emotion:', d.get('emotion'), 'Text:', d.get('text'))"

# 6. Update config
echo "6. Update config..."
curl -s -X PUT "https://oface.io/$USERNAME/api/config" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"face":"default","config":{"body":"pack","head":"pack"}}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', d.get('ok'), 'Face:', d.get('face'))"

# 7. Read config back
echo "7. Read config (GET)..."
curl -s "https://oface.io/$USERNAME/api/config" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Face:', d.get('face'), 'Config:', json.dumps(d.get('config',{})))"

# 8. Verify viewer page
echo "8. Verify viewer page..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://oface.io/$USERNAME")
echo "  Viewer HTTP status: $STATUS"

# 9. Verify dashboard redirect
echo "9. Verify dashboard redirect..."
DASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://oface.io/$USERNAME/dashboard")
echo "  Dashboard HTTP status: $DASH_STATUS (302 = redirect = correct)"

# 10. Verify health
echo "10. Health check..."
curl -s "https://oface.io/$USERNAME/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', d.get('ok'), 'Viewers:', d.get('viewers'), 'Agents:', d.get('agents'), 'State:', d.get('state'))"

# 11. Verify unauthorized push is rejected
echo "11. Verify auth rejection..."
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://oface.io/$USERNAME/api/state" \
  -H "Content-Type: application/json" \
  -d '{"state":"alert"}')
echo "  Unauthorized push status: $UNAUTH (401 = correct)"

# 12. Push idle to clean up
echo "12. Reset to idle..."
curl -s -X POST "https://oface.io/$USERNAME/api/state" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"idle","emotion":"neutral","text":null}' > /dev/null

echo ""
echo "=== E2E Test Complete ==="
echo "Face URL: https://oface.io/$USERNAME"
echo "Dashboard: https://oface.io/$USERNAME/dashboard?token=$API_KEY"
