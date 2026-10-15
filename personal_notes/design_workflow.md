# Design Workflow (Claude Design → Claude Code)

## Ask for realistic content and empty states

When designing a screen in Claude Design, ask it to use realistic content
from our domain and to show the empty states. For example: "a person with
no milestones and two prayer burdens, one with comments and one without."

**Why:** a mockup with generic placeholder data usually skips the cases our
business rules require (zero people, zero milestones, zero burdens, a burden
with no comments, a standalone comment). If the design already covers them,
Claude Code builds them from the design instead of inventing them.

## Handoff

Paste the design's claude.ai link into Claude Code and name the target,
e.g. "implement this as `PeoplePage.tsx`". One screen per design.
