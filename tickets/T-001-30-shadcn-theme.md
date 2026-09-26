---
id: T-001-30
title: "shadcn theme bootstrap"
type: frontend
status: in_review
risk: low
depends_on:
  - T-001-07
files:
  - "package.json"
  - "components.json"
  - "tailwind.config.ts"
  - "postcss.config.mjs"
  - "src/app/globals.css"
  - "src/app/tokens.css"
  - "src/lib/utils.ts"
  - "src/components/ui/button.tsx"
  - "src/components/ui/input.tsx"
  - "src/components/ui/label.tsx"
  - "src/components/ui/card.tsx"
skills:
  - build
  - frontend-patterns
  - design-taste-frontend
  - redesign-existing-projects
  - vercel-react-best-practices
contracts: "arch/CONTRACTS.md#Screens"
requirements:
  - F-001-1
  - F-001-2
  - N-001-1
acceptance_criteria:
  - "Tailwind CSS and shadcn/ui are installed and configured for this Next.js App Router app with a CSS variables theme"
  - "design/DESIGN.md product tokens are mapped into shadcn CSS variables in src/app/globals.css and/or src/app/tokens.css: --background, --card, --foreground, --muted-foreground, --border, --primary from accent #0e6b4f, --destructive, --warning, --success, --ring, the paired *-foreground variables, and --radius, plus the rest of that theme mapping table (--popover, --input, --muted, --secondary, and shadcn --accent as the hover pair rather than the brand CTA). Hex and raw sizes appear only in those stylesheets"
  - "Tailwind registers those variables so semantic utilities resolve, using v3 theme.extend or v4 @theme; ADR-0002 leaves the major open. Ship the config files that major needs from this ticket's file list and do not add an unused second config"
  - "Existing --bg, --accent, and sibling token consumers either migrate to the shadcn names or get thin aliases that forward to them, and product roles stay unchanged"
  - "Fonts remain IBM Plex Sans and IBM Plex Sans Arabic, layout uses logical properties, focus uses --ring, and the theme is light only"
  - "The change adds no second component library and no second spacing language beyond the design/DESIGN.md scale"
  - "The change adds no new product screens and no API routes"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
  - decisions/ADR-0002-shadcn-ui.md
---

Install Tailwind CSS and shadcn/ui, and map design/DESIGN.md into the theme CSS variables. Base primitives for the shell are button, input, label, and card. Leave product surfaces to the tickets that depend on this one. No extra product features.
