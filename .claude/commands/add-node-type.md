---
description: "Scaffold a new workflow node type with handler, types, UI component, and test"
argument-hint: <node-type-name> <category: triggers|logic|integration|output>
---

# Add Node Type: $ARGUMENTS

## Steps

### 1. Parse arguments
Extract node type name and category from: $ARGUMENTS
Example: `webhook-v2 triggers` or `slack integration`

### 2. Create handler file
Create `packages/server/src/nodes/<category>/<type-name>.ts`:

```typescript
import type { WorkflowNode } from '@flowaibuilder/shared';
import type { BaseNodeHandler } from '../../engine/node-runner.js';
import type { NodeContext } from '../../engine/context.js';

export const <typeName>Handler: BaseNodeHandler = {
  async execute(node: WorkflowNode, context: NodeContext): Promise<unknown> {
    // TODO: implement
    return context.$input.all();
  },
};
```

### 3. Register in node index
Add to `packages/server/src/nodes/index.ts`:
```typescript
import { <typeName>Handler } from './<category>/<type-name>.js';
registerNodeHandler('<type-name>', <typeName>Handler);
```

### 4. Update shared types
Add to `NodeType` union in `packages/shared/src/types/workflow.ts`
Add metadata to `packages/shared/src/constants/node-types.ts`

### 5. Create UI component
Create `packages/ui/src/components/canvas/nodes/<TypeName>Node.tsx`
Follow the pattern from existing nodes (TriggerNode, CodeNode, etc.)
Register in the nodeTypes map in Canvas.tsx

### 6. Create test
Create `packages/server/tests/nodes/<type-name>.test.ts`
Minimum: one happy path test and one error case test

### 7. Summary
Print what was created and remind to run tests.
