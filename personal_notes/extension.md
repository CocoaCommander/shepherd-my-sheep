# Future Extension Plans

## Public-Facing Version

The app is currently designed for Christian shepherding (caring for people in
a church/ministry context), but the core concept — tracking progress of people
you're caring for — is broadly applicable.

Potential future directions:
- Mentorship programs
- Social work case management
- Nonprofit volunteer coordination
- General discipleship / coaching

## What This Means Architecturally

When the time comes to abstract for public use:

- **"Prayer Burden" becomes generic** — rename to something like "Concern" or
  "Care Item" with a configurable label. The underlying data model (content,
  released/resolved status, comments) stays the same.
- **Milestones become user-defined** — the current seed milestones are
  church-specific (baptised, joined small group). A public version needs
  fully customizable milestone templates per organization.
- **Terminology is configurable** — "shepherd" → "mentor", "prayer burden" →
  "action item", etc. This could be a simple config/theme layer, not a
  schema change.
- **Multi-tenancy** — each organization gets its own data. Add an
  `organization_id` to the core tables and scope all queries.
- **SEO may matter then** — if the app has a public landing page or shared
  dashboards, consider adding Next.js for those pages or a static site for
  marketing. The app itself (behind login) stays as a Vite SPA.
