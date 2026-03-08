# ADR-0014: Frontend Styling and Design System

- Status: Proposed
- Date: 2026-03-08

## Context

Kanbun is intended to be a polished, open-source product. The repository already defines architecture and workflow behavior, but the frontend stack still needs an explicit styling decision.

Without a styling ADR, the UI will likely drift into:

- inconsistent spacing and hierarchy
- ad hoc component styling
- unclear token usage
- hard-to-maintain visual regressions

## Decision

Kanbun will use:

- Tailwind CSS as the primary styling system
- `shadcn/ui` as the starting component system
- CSS variables for design tokens such as color, spacing, radius, shadows, and typography roles
- a small internal design system in the application repository
- application-owned tokens and customized components rather than default `shadcn/ui` styling

The goal is to keep the UI fast to build, easy to maintain, and visually distinctive without inheriting a generic template aesthetic.

## Why this direction

### Tailwind is a pragmatic implementation layer

Tailwind is a strong fit because it:

- works well with Next.js
- keeps styling close to components
- is well documented
- is easy for agents and contributors to reason about
- makes token-driven consistency practical

### Tokens must exist outside utility classes

A polished interface needs stable visual rules, not only utility combinations.

CSS variables should define the system-level tokens so the project has a durable language for:

- semantic colors
- spacing scale
- radii
- shadows
- motion timing
- typography roles

### `shadcn/ui` is the right baseline

`shadcn/ui` is a good fit because it provides:

- an accessible component starting point
- Tailwind-native implementation
- repo-local component ownership
- easy customization without framework lock-in

This keeps the component layer practical while still allowing Kanbun to develop its own visual identity.

### Avoid stock styling

Kanbun should not feel like a stock `shadcn` dashboard. The project should treat `shadcn/ui` as an implementation baseline, not as the final product aesthetic.

## Styling architecture

### Token layers

The styling system should define:

- core tokens: raw color, spacing, radius, motion, and typography values
- semantic tokens: surface, border, accent, muted text, danger, success, warning
- component tokens where a repeated pattern needs a stable contract

### Component strategy

Reusable UI components should exist for:

- buttons
- inputs
- forms
- dialogs
- tables and lists
- badges and tags
- panels and cards
- navigation shells
- timeline and activity items

These components should consume shared tokens rather than invent local one-off styles.
`shadcn/ui` components should be customized as needed and checked into the repository rather than treated as an untouchable external theme layer.

### Layout strategy

The interface should support:

- dense but readable data views
- desktop-first productivity use
- clean mobile degradation for core workflows

The design system should not assume a marketing-site layout model.

## Accessibility and states

The component system must explicitly support:

- keyboard navigation
- focus-visible treatment
- color contrast requirements
- hover, active, disabled, loading, empty, and error states

Accessibility behavior should be part of the component contract, not an afterthought.

## Theming model

The first phase should define one strong default theme with a complete token set.

Dark mode can be supported later, but it should not dilute the first visual pass. The default experience should be polished before theme expansion.

## Consequences

### Positive

- clear frontend implementation path
- stable token-driven styling
- strong fit for an open-source Next.js codebase
- lower risk of visual inconsistency

### Costs and risks

- the design system needs real discipline to avoid utility-class sprawl
- headless primitives still require careful assembly and testing
- a distinctive visual language must be intentionally designed, not assumed

## Follow-up implementation work

- define the initial token set
- choose the exact Tailwind and primitive-library versions
- define base app shell, type scale, and surface patterns
- create the initial component inventory

## Related ADRs

- [ADR-0001: Foundation for Kanbun](./0001-foundation.md)
- [ADR-0010: Repository Workflow, CI, and Agent Harness](./0010-repository-workflow-ci-and-agent-harness.md)
