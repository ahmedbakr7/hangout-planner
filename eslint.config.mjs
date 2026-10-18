import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx", "browser/**/*.ts"];

function aliasPatterns(alias, message) {
  return [
    { group: [alias, `${alias}/*`], message },
    {
      regex: `^(\\.{1,2}/)+(.*/)?${alias.slice(2)}(/|$)`,
      message: `${message} (relative path to the same folder)`,
    },
  ];
}

const serverBoundary = [
  {
    group: ["react", "react-dom", "react/*", "react-dom/*", "next/navigation"],
    message:
      "src/server has no React or next/navigation imports (frontend-patterns folder layout).",
  },
  ...aliasPatterns(
    "@/components",
    "src/server must not import @/components (frontend-patterns folder layout).",
  ),
  ...aliasPatterns(
    "@/app",
    "src/server must not import @/app (frontend-patterns folder layout).",
  ),
];

const libBoundary = [
  ...aliasPatterns(
    "@/server",
    "src/lib must not import @/server (frontend-patterns: pure helpers).",
  ),
  ...aliasPatterns(
    "@/components",
    "src/lib must not import @/components (frontend-patterns: pure helpers).",
  ),
  ...aliasPatterns(
    "@/app",
    "src/lib must not import @/app (frontend-patterns: pure helpers).",
  ),
];

const componentsBoundary = aliasPatterns(
  "@/server",
  "src/components must not import @/server (frontend-patterns: the browser talks to /api/v1).",
);

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/",
    "node_modules/",
    ".sdlc/",
    ".sdlc-run/",
    "skills/",
    "next-env.d.ts",
  ]),
  {
    files: ["src/server/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: {
      "no-restricted-imports": ["error", { patterns: serverBoundary }],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: libBoundary }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: {
      "no-restricted-imports": ["error", { patterns: componentsBoundary }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "No raw hex colour outside the theme CSS (ADR-0002); use a semantic Tailwind class.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "No raw hex colour outside the theme CSS (ADR-0002); use a semantic Tailwind class.",
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            "No inline style attribute (ADR-0002); use a semantic Tailwind class.",
        },
      ],
    },
  },
]);
