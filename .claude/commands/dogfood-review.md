---
description: "End-to-end self-test: create a workflow, run AI review, verify annotations appear. flowAIbuilder reviews itself."
---

# Dogfood Review - flowAIbuilder Tests Itself

## Purpose
Verify the full loop works: create workflow via MCP -> review via MCP -> annotations saved -> fixes applied.

## Steps

### 1. Create test workflow
Call `flowaibuilder.create_workflow`:
```json
{ "name": "Dogfood Test - Lead Pipeline", "description": "Self-test workflow" }
```

### 2. Add nodes with deliberate issues
Add 4 nodes that have known problems for the reviewer to catch:

**Webhook** (clean):
```json
{ "type": "webhook", "name": "Webhook", "config": { "method": "POST", "path": "/test" } }
```

**HTTP Request WITHOUT auth** (should trigger error):
```json
{ "type": "http-request", "name": "CRM Call", "config": { "url": "https://api.example.com/contacts", "method": "GET" } }
```

**IF with no false branch** (should trigger warning):
```json
{ "type": "if", "name": "Score Check", "config": { "field": "score", "operator": "greater_than", "value": "7" } }
```

**Respond webhook** (clean, but connect only to true branch):
Connect: webhook -> http -> if -> respond (true only)

### 3. Run review
Call `flowaibuilder.get_review_context` with the workflow ID.
Analyze the returned context yourself. Save annotations:

Expected annotations:
- ERROR on "CRM Call": missing Authorization header
- WARNING on "Score Check": false branch is a dead end
- SUGGESTION: add error handling after HTTP node

Call `flowaibuilder.save_annotations` with your findings.

### 4. Verify
- Call `flowaibuilder.get_annotations` - should return 2-3 annotations
- Check that health_score is < 70 (issues present)

### 5. Apply fix
Pick the auth header fix and call `flowaibuilder.apply_fix`.
Verify the node was updated.

### 6. Re-review
Run get_review_context again. The auth error should be gone.
Health score should improve.

### 7. Cleanup
Delete the test workflow.

### 8. Report
Print pass/fail for each step:
- [ ] Workflow created
- [ ] Nodes added with connections
- [ ] Review context returned with node data
- [ ] Annotations saved (expected count)
- [ ] Health score calculated
- [ ] Fix applied successfully
- [ ] Re-review shows improvement
- [ ] Cleanup complete
