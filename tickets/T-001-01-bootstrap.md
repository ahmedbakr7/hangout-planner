---
id: T-001-01
title: "App bootstrap"
type: backend
status: done
risk: low
depends_on: []
files:
  - "package.json"
  - "tsconfig.json"
  - "next.config.ts"
  - "vitest.config.ts"
  - "drizzle.config.ts"
  - "src/server/db/client.ts"
skills:
  - build
  - backend-patterns
contracts: "arch/CONTRACTS.md"
requirements: []
acceptance_criteria:
  - "AC-1: package.json engines field is Node 22"
  - "AC-2: dependencies are next, react, react-dom, drizzle-orm, postgres, argon2, and next-intl, and devDependencies are typescript, @types/node, @types/react, @types/react-dom, drizzle-kit, vitest, jsdom, and @testing-library/react"
  - "AC-3: The dependency set does not include Tailwind, Prisma, NextAuth, or a second HTTP client"
  - "AC-4: tsconfig is TypeScript strict and @/ maps to src/"
  - "AC-5: Vitest runs"
  - "AC-6: The Drizzle client reads DATABASE_URL"
source_intent: intent/intent-001-core-plan-loop.md
source_spec: design/spec-001-core-plan-loop.md
source_plan: arch/plan-001-core-plan-loop.md
source_adr:
  - decisions/ADR-0001-stack.md
---

Bootstrap the Next.js app, the Drizzle client, and Vitest. No routes, no tables, and no extra files.
