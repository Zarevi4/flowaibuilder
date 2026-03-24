# n8n Compatibility Skill

## Purpose
flowAIbuilder can import n8n workflow JSON and convert it to our format.
This skill documents the mapping between n8n and flowAIbuilder.

## n8n Workflow JSON Structure
```json
{
  "name": "My Workflow",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [250, 300],
      "parameters": {
        "path": "my-hook",
        "httpMethod": "POST"
      },
      "webhookId": "xxx"
    },
    {
      "name": "Code",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [450, 300],
      "parameters": {
        "jsCode": "return items.map(item => ({ json: item.json }));"
      }
    }
  ],
  "connections": {
    "Webhook": {
      "main": [[{ "node": "Code", "type": "main", "index": 0 }]]
    }
  }
}
```

## Node Type Mapping: n8n -> flowAIbuilder

| n8n type | flowAIbuilder type | Notes |
|----------|-------------------|-------|
| n8n-nodes-base.webhook | webhook | Map httpMethod -> method |
| n8n-nodes-base.scheduleTrigger | schedule | Map rule -> cron expression |
| n8n-nodes-base.manualTrigger | manual | |
| n8n-nodes-base.code | code-js | jsCode -> code, Python -> code-python |
| n8n-nodes-base.httpRequest | http-request | Map url, method, headers, body |
| n8n-nodes-base.if | if | Map conditions -> field/operator/value |
| n8n-nodes-base.switch | switch | |
| n8n-nodes-base.merge | merge | |
| n8n-nodes-base.set | set | Map assignments -> field/value pairs |
| n8n-nodes-base.respondToWebhook | respond-webhook | |
| @n8n/n8n-nodes-langchain.* | ai-agent | Map to generic AI agent |
| Any other | generic | Store original config, mark as unsupported |

## Connection Format Conversion

n8n connections use node NAMES as keys:
```json
"connections": {
  "Webhook": { "main": [[{ "node": "Code", "type": "main", "index": 0 }]] }
}
```

flowAIbuilder uses node IDs:
```json
"connections": [
  { "id": "edge_1", "sourceNodeId": "node_1", "targetNodeId": "node_2", "sourceHandle": "default", "targetHandle": "default" }
]
```

Converter must: build name->id map, then translate connections.

## Position Conversion
n8n: `position: [x, y]` (array)
flowAIbuilder: `position: { x, y }` (object)

## Key Gotchas from n8n-skills

### Expression Syntax
n8n uses `={{ $json.field }}` in parameters.
flowAIbuilder uses `{{$json.field}}` (no = prefix).
Converter must strip leading `=` from expressions.

### Webhook Data Access
In n8n, webhook body is at `$json.body` (not `$json` directly).
flowAIbuilder follows same convention for compatibility.

### Code Node Return Format
n8n expects: `return [{ json: { ... } }]` (array of items)
flowAIbuilder accepts same format.

### IF Node Conditions
n8n v2 IF uses:
```json
{ "conditions": { "options": { "caseSensitive": true }, "combinator": "and",
  "conditions": [{ "leftValue": "={{ $json.score }}", "rightValue": 7, "operator": { "type": "number", "operation": "gte" } }]
}}
```
flowAIbuilder simplifies to: `{ "field": "score", "operator": "greater_than", "value": "7" }`

## Import MCP Tool
```
flowaibuilder.import_n8n  { n8n_workflow_json: object }
```
Returns: `{ workflow_id, import_report: { imported_nodes, unsupported_nodes, warnings } }`

## Unsupported Node Handling
When an n8n node type has no flowAIbuilder equivalent:
1. Create a "generic" node with the original config stored as-is
2. Mark it with a warning annotation: "Imported from n8n - type not natively supported"
3. Include in import_report.unsupported_nodes
