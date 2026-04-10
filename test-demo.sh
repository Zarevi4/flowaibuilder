#!/bin/bash
# flowAIbuilder Demo Setup Script
# Creates a test workflow + fake Agent Teams data
# Run: bash test-demo.sh

set -e
API="http://localhost:3000"

echo "=== flowAIbuilder Demo Setup ==="
echo ""

# ─── Step 1: Create workflow ───
echo "1. Creating Lead Qualification workflow..."
WF=$(curl -s -X POST "$API/api/workflows" \
  -H "Content-Type: application/json" \
  -d '{"name": "Lead Qualification Pipeline", "description": "Qualify leads from website form, score them, route hot leads to sales"}')

WF_ID=$(echo "$WF" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "$WF" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$WF_ID" ]; then
  echo "Error creating workflow. Is the server running? Try: docker compose up -d"
  exit 1
fi

echo "   Workflow ID: $WF_ID"

# ─── Step 2: Add nodes ───
echo "2. Adding nodes..."

# Webhook trigger
NODE1=$(curl -s -X POST "$API/api/workflows/$WF_ID/nodes" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "webhook",
    "name": "Webhook: /leads",
    "config": {"method": "POST", "path": "/leads"}
  }')
N1_ID=$(echo "$NODE1" | python3 -c "import sys,json; print(json.load(sys.stdin)['node']['id'])" 2>/dev/null || echo "$NODE1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   + Webhook node: $N1_ID"

# Code node - extract & score
NODE2=$(curl -s -X POST "$API/api/workflows/$WF_ID/nodes" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "code-js",
    "name": "Score Lead",
    "config": {
      "code": "const lead = $json.body || $json;\nconst score = lead.score || Math.floor(Math.random() * 10) + 1;\nreturn {\n  name: lead.name || \"Unknown\",\n  email: lead.email || \"\",\n  company: lead.company || \"\",\n  score: score,\n  qualified: score >= 7,\n  tier: score >= 9 ? \"hot\" : score >= 7 ? \"warm\" : \"cold\",\n  message: `Lead ${lead.name} scored ${score}/10 - ${score >= 7 ? \"QUALIFIED\" : \"nurture\"}`\n};"
    }
  }')
N2_ID=$(echo "$NODE2" | python3 -c "import sys,json; print(json.load(sys.stdin)['node']['id'])" 2>/dev/null || echo "$NODE2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   + Score Lead node: $N2_ID"

# IF node - check qualification
NODE3=$(curl -s -X POST "$API/api/workflows/$WF_ID/nodes" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "if",
    "name": "Qualified?",
    "config": {"field": "qualified", "operator": "equals", "value": "true"}
  }')
N3_ID=$(echo "$NODE3" | python3 -c "import sys,json; print(json.load(sys.stdin)['node']['id'])" 2>/dev/null || echo "$NODE3" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   + IF node: $N3_ID"

# Set node - format for sales (true branch)
NODE4=$(curl -s -X POST "$API/api/workflows/$WF_ID/nodes" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "set",
    "name": "Format for Sales",
    "config": {
      "fields": [
        {"name": "alert", "value": "NEW HOT LEAD"},
        {"name": "action", "value": "Call within 5 minutes"}
      ],
      "keepExisting": true
    }
  }')
N4_ID=$(echo "$NODE4" | python3 -c "import sys,json; print(json.load(sys.stdin)['node']['id'])" 2>/dev/null || echo "$NODE4" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   + Format for Sales node: $N4_ID"

# Respond webhook - return result
NODE5=$(curl -s -X POST "$API/api/workflows/$WF_ID/nodes" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "respond-webhook",
    "name": "Response",
    "config": {"statusCode": 200}
  }')
N5_ID=$(echo "$NODE5" | python3 -c "import sys,json; print(json.load(sys.stdin)['node']['id'])" 2>/dev/null || echo "$NODE5" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "   + Response node: $N5_ID"

# ─── Step 3: Connect nodes ───
echo "3. Connecting nodes..."

curl -s -X POST "$API/api/workflows/$WF_ID/connections" \
  -H "Content-Type: application/json" \
  -d "{\"sourceNodeId\": \"$N1_ID\", \"targetNodeId\": \"$N2_ID\"}" > /dev/null
echo "   Webhook → Score Lead"

curl -s -X POST "$API/api/workflows/$WF_ID/connections" \
  -H "Content-Type: application/json" \
  -d "{\"sourceNodeId\": \"$N2_ID\", \"targetNodeId\": \"$N3_ID\"}" > /dev/null
echo "   Score Lead → IF Qualified?"

curl -s -X POST "$API/api/workflows/$WF_ID/connections" \
  -H "Content-Type: application/json" \
  -d "{\"sourceNodeId\": \"$N3_ID\", \"targetNodeId\": \"$N4_ID\", \"sourceHandle\": \"output-0\"}" > /dev/null
echo "   IF (true) → Format for Sales"

curl -s -X POST "$API/api/workflows/$WF_ID/connections" \
  -H "Content-Type: application/json" \
  -d "{\"sourceNodeId\": \"$N4_ID\", \"targetNodeId\": \"$N5_ID\"}" > /dev/null
echo "   Format for Sales → Response"

# ─── Step 4: Create Agent Teams test data ───
echo ""
echo "4. Setting up Agent Teams demo..."

TEAM_DIR="$HOME/.claude/teams/lead-pipeline-team"
mkdir -p "$TEAM_DIR/inboxes"

# Tasks
cat > "$TEAM_DIR/tasks.json" << 'TASKS'
[
  {
    "id": "task-001",
    "title": "Build webhook trigger + data extraction",
    "status": "done",
    "assignee": "api-builder",
    "blockedBy": []
  },
  {
    "id": "task-002",
    "title": "Create lead scoring logic with AI prompt",
    "status": "done",
    "assignee": "ai-classifier",
    "blockedBy": []
  },
  {
    "id": "task-003",
    "title": "Build qualification routing (IF node)",
    "status": "in_progress",
    "assignee": "api-builder",
    "blockedBy": []
  },
  {
    "id": "task-004",
    "title": "Add Slack notification for hot leads",
    "status": "blocked",
    "assignee": "api-builder",
    "blockedBy": ["task-003"]
  },
  {
    "id": "task-005",
    "title": "Review all nodes for security issues",
    "status": "unassigned",
    "assignee": null,
    "blockedBy": ["task-003", "task-004"]
  }
]
TASKS
echo "   + Created tasks.json (5 tasks)"

# Team lead inbox
cat > "$TEAM_DIR/inboxes/team-lead.json" << 'INBOX'
[
  {
    "id": "msg-001",
    "from": "api-builder",
    "text": "Webhook trigger and data extraction are done. Moving to qualification routing next.",
    "timestamp": "2026-03-28T14:30:00Z",
    "read": true
  },
  {
    "id": "msg-002",
    "from": "ai-classifier",
    "text": "Lead scoring prompt is ready. Using score 1-10 based on company size, budget, and source. Threshold at 7 for qualified.",
    "timestamp": "2026-03-28T14:35:00Z",
    "read": true
  },
  {
    "id": "msg-003",
    "from": "api-builder",
    "text": "Question: should the IF node route score >= 7 to Slack directly, or go through a formatter first?",
    "timestamp": "2026-03-28T15:10:00Z",
    "read": false
  }
]
INBOX
echo "   + Created team-lead inbox (3 messages)"

# API builder inbox
cat > "$TEAM_DIR/inboxes/api-builder.json" << 'INBOX'
[
  {
    "id": "msg-010",
    "from": "team-lead",
    "text": "Good work on the webhook. Add a formatter node between IF and Slack - we need structured alerts.",
    "timestamp": "2026-03-28T15:15:00Z",
    "read": false
  }
]
INBOX
echo "   + Created api-builder inbox"

# AI classifier inbox
cat > "$TEAM_DIR/inboxes/ai-classifier.json" << 'INBOX'
[
  {
    "id": "msg-020",
    "from": "team-lead",
    "text": "Scoring logic approved. Stand by for review phase.",
    "timestamp": "2026-03-28T15:20:00Z",
    "read": true
  }
]
INBOX
echo "   + Created ai-classifier inbox"

# Reviewer inbox (empty - waiting)
echo '[]' > "$TEAM_DIR/inboxes/reviewer.json"
echo "   + Created reviewer inbox (empty - waiting)"

# ─── Step 5: Tell flowAIbuilder to watch the team ───
echo ""
echo "5. Telling flowAIbuilder to watch the team..."
WATCH=$(curl -s -X POST "$API/api/teams/lead-pipeline-team/watch" 2>/dev/null || echo "skip")
if echo "$WATCH" | grep -q "error\|skip"; then
  echo "   (Team watch endpoint may need manual trigger via MCP - see below)"
else
  echo "   + Watching lead-pipeline-team"
fi

# ─── Done! ───
echo ""
echo "============================================"
echo "  Demo ready!"
echo "============================================"
echo ""
echo "  Open these URLs:"
echo ""
echo "  1. WORKFLOW EDITOR:"
echo "     http://localhost:5173/editor/$WF_ID"
echo "     → See the Lead Qualification Pipeline"
echo "     → Click Run to execute with test data"
echo ""
echo "  2. AGENT TEAMS DASHBOARD:"
echo "     http://localhost:5173/teams/lead-pipeline-team"
echo "     → See agent cards, task board, messages"
echo ""
echo "  3. EXECUTE WITH TEST DATA:"
echo "     curl -X POST $API/api/workflows/$WF_ID/execute \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"triggerData\":{\"body\":{\"name\":\"Marie Dupont\",\"email\":\"marie@lux-finance.lu\",\"company\":\"Luxembourg Finance SA\",\"score\":9,\"source\":\"website\"}}}'"
echo ""
echo "  4. EXECUTE WITH LOW SCORE (different path):"
echo "     curl -X POST $API/api/workflows/$WF_ID/execute \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"triggerData\":{\"body\":{\"name\":\"Random Visitor\",\"email\":\"random@gmail.com\",\"score\":3}}}'"
echo ""
echo "  Workflow ID: $WF_ID"
echo "============================================"
