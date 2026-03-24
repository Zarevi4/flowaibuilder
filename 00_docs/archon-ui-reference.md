# Archon UI Reference for flowAIbuilder

## Source Location
`/Users/macbookpro16/Documents/AIworkspace/Archon/archon-ui-main/`

## What to Reuse from Archon

### 1. Tailwind v4 + CSS Variables Setup
Copy and adapt from Archon:
- `tailwind.config.js` (Tailwind v4 minimal config)
- `postcss.config.js`
- `src/index.css` - HSL-based CSS variables with `@theme inline` block

**Adapt**: Replace Archon's "Tron neon" color scheme with flowAIbuilder palette:
- Keep the HSL variable structure (it's clean)
- Replace purple neon accents with professional blues/teals
- Keep dark mode support (essential for developer tool)
- Remove neon-grid, pulse-glow, and other Tron-specific effects

### 2. Radix UI Primitives (copy package deps)
From Archon's package.json, copy these dependencies:
```
@radix-ui/react-alert-dialog
@radix-ui/react-checkbox
@radix-ui/react-dialog
@radix-ui/react-dropdown-menu
@radix-ui/react-label
@radix-ui/react-popover
@radix-ui/react-radio-group
@radix-ui/react-select
@radix-ui/react-switch
@radix-ui/react-tabs
@radix-ui/react-toast
@radix-ui/react-tooltip
```

### 3. UI Components to Copy + Adapt
Source: `Archon/archon-ui-main/src/components/ui/`

| Component | Reuse | Adapt |
|-----------|-------|-------|
| Button.tsx | Structure + variants | Remove neon glow, simplify to clean flat style |
| Card.tsx | Structure + accentColor system | Remove backdrop-blur and neon, keep color accents for node types |
| Badge.tsx | As-is | Change colors to match workflow node types |
| Input.tsx | As-is | Minimal changes |
| Select.tsx | As-is | Minimal changes |
| Checkbox.tsx | As-is | |
| Toggle.tsx | As-is | |
| ThemeToggle.tsx | As-is | Essential for dev tools |

### 4. Shared Dependencies (same in both projects)
```
react, react-dom
zustand (state management)
lucide-react (icons)
framer-motion (animations)
clsx + tailwind-merge (className utils)
zod (validation)
react-router-dom (routing)
```

### 5. Dev Dependencies (same versions)
```
tailwindcss@4.1.2
@tailwindcss/vite@4.1.2
@tailwindcss/postcss@4.1.2
vite@5.x
typescript@5.x
@vitejs/plugin-react
```

## What NOT to Copy
- `react-dnd` - flowAIbuilder uses @xyflow/react which has its own drag-drop
- `@mdxeditor/editor` - not needed
- `prismjs` - not needed (we'll use a lighter code highlighter or Monaco)
- Archon's `features/`, `services/`, `pages/` - these are Archon-specific
- Neon grid background, glow effects, Tron aesthetic

## What to ADD (not in Archon)
```
@xyflow/react          # Canvas - THE core UI library
@xyflow/react/dist/style.css
monaco-editor or @monaco-editor/react  # Code editing in nodes (optional, textarea for MVP)
```

## Recommended Approach for Claude Code

```
Step 1: Copy Archon's base Tailwind/CSS setup into packages/ui/
Step 2: Copy the UI components (Button, Card, Badge, Input, Select, Toggle, ThemeToggle)
Step 3: Adapt colors: replace purple neon with flowAIbuilder palette
Step 4: Add @xyflow/react and build canvas-specific components on top
Step 5: Build flowAIbuilder pages (Dashboard, Editor, Executions, Settings)
```

## Color Palette for flowAIbuilder (replacing Archon's Tron theme)

Node type colors (same as in PRD):
- Triggers: purple (#7F77DD)
- Code/Transform: teal (#1D9E75)
- HTTP/API: coral (#D85A30)
- Conditions/Routing: amber (#BA7517)
- AI nodes: pink (#D4537E)
- Output/Generic: gray (#888780)

UI accent: blue (#378ADD) for primary actions, links, focus states
Success: green (#639922)
Warning: amber (#BA7517)
Error: red (#E24B4A)
