# Optional GitHub Actions validation

`validate.yml` runs dependency installation, the automated checks, production build and synthetic demo setup with Node.js 24.19.0. Its official checkout/setup actions are pinned to verified commits and repository permissions are read-only.

It is a template rather than an active workflow. The publishing credential can write repository content but cannot create GitHub Actions workflows. The application and demo run independently of Actions; their checks were run locally before publication.

To enable it later, use an account or credential authorized to manage this repository's workflows, place the template at `.github/workflows/validate.yml`, and commit that change. No APS secrets are required by these checks.
