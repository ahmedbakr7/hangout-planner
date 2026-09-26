# Product GitHub Actions (hangout-planner)

Adapted from `.sdlc/adapters/github/product-pr-checks.yml` (kit pin `6ac198c`).

## Install into `.github/workflows/`

Pushing files under `.github/workflows/` requires a credential with the GitHub
`workflow` OAuth scope (the default `gh`/`repo` OAuth app token is not enough).

```bash
mkdir -p .github/workflows
cp adapters/github/product-pr-checks.yml .github/workflows/product-pr-checks.yml
git add .github/workflows/product-pr-checks.yml
git commit -m "ci: enable product-pr-checks workflow"
git push
```

Use a PAT (classic) that includes the `workflow` scope, or the GitHub web UI.
