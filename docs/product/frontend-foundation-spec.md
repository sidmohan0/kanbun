# Frontend Foundation Spec

## Purpose

This document turns the frontend styling decisions into an implementation-ready foundation for the first UI bootstrap.

It defines:

- the initial app shell
- the first design-token set
- the typography and spacing system
- the first component inventory
- the initial `shadcn/ui` install set

## First implementation target

The first frontend bootstrap should be able to render:

- the global app shell
- a `Home` dashboard shell
- a `Contacts` list shell
- a `Contact` detail shell
- a `Sequences` list shell
- a `Tasks` list shell
- a `Settings` shell

These may begin as static or mocked views, but they should use the real app shell and real component primitives from day one.

## App shell

### Layout model

The base application should use a two-layer shell:

- left sidebar for primary navigation
- main content region with top contextual header

On desktop:

- the sidebar should remain persistent
- the main content area should support wide operational views

On mobile:

- navigation can collapse into a sheet or drawer
- the page header should preserve the current section title and key action

### Primary navigation items

The first shell should support:

- Home
- Contacts
- Sequences
- Tasks
- Imports
- Settings

### Persistent utility zones

The shell should reserve visible space for:

- global search
- quick-add actions
- system health or sync-status indicator

## Visual direction

The UI should use a restrained, editorial-operational visual language.

Practical interpretation:

- off-white or soft-neutral background instead of bright white
- dark ink-like text rather than pure black
- warm neutral surfaces with one controlled accent family
- subtle borders and separation instead of loud card chrome

## Design tokens

### Color tokens

The first token set should define:

- `--background`
- `--foreground`
- `--surface`
- `--surface-raised`
- `--surface-muted`
- `--border`
- `--border-strong`
- `--accent`
- `--accent-foreground`
- `--muted`
- `--muted-foreground`
- `--success`
- `--warning`
- `--danger`
- `--focus-ring`

### Suggested color posture

The first palette should lean:

- warm neutral background
- charcoal or deep olive text
- muted stone or sand surfaces
- one dark green, rust, or ink-blue accent family

The exact hues can be refined during implementation, but the system should avoid generic bright-blue SaaS defaults.

### Spacing scale

Use a tight, practical spacing scale:

- `4`
- `8`
- `12`
- `16`
- `24`
- `32`
- `48`
- `64`

Operational screens should feel efficient, while detail views can breathe more.

### Radius scale

The first radius system should stay restrained:

- small: `6px`
- medium: `10px`
- large: `14px`

Avoid overly soft, bubbly surfaces.

### Shadow model

Shadows should be subtle and rare.

Use them mainly for:

- dialogs
- popovers
- raised secondary surfaces

Default panels should rely more on border, tone, and spacing than shadow depth.

## Typography system

### General direction

Typography should carry the hierarchy of the product.

The first phase should use:

- one primary sans family for interface text
- one optional secondary serif or high-character display face only if it remains disciplined

If a second family is introduced, it should be limited to page titles or special editorial moments, not body copy.

### Type roles

Define these type roles explicitly:

- `display`
- `page-title`
- `section-title`
- `card-title`
- `body`
- `body-small`
- `label`
- `meta`
- `mono`

### Practical sizing direction

The initial scale should roughly support:

- page title: `30-36px`
- section title: `18-22px`
- body: `14-16px`
- meta: `12-13px`

Metadata should be quieter, but still readable.

## Surface patterns

### Page sections

Default page sections should use:

- a clear title row
- optional secondary description or action slot
- content grouped beneath with stable vertical rhythm

### Panels and cards

Use panels for:

- filters
- settings groups
- summary blocks
- timeline segments

Avoid turning every item into a heavy standalone card.

### Data lists

Lists should feel:

- dense
- legible
- clearly segmented

Row hover and selection states should be obvious without becoming noisy.

## Interaction patterns

### Search

Global search should be one of the first shell-level interactions implemented.

The initial version can target:

- contacts by name
- contacts by email

### Quick-add

The app shell should support quick entry points for:

- new contact
- new follow-up
- new sequence

### Status visibility

The shell should make room for:

- sync failures
- pending send approvals
- import warnings

The operator should not need to hunt for these.

## Initial component inventory

The first internal UI inventory should include:

- `AppShell`
- `SidebarNav`
- `PageHeader`
- `SectionHeader`
- `DataTable`
- `FilterBar`
- `EmptyState`
- `StatusBadge`
- `MetricCard`
- `ActivityTimeline`
- `EntityRow`
- `ContactCard`
- `TaskRow`
- `ApprovalPanel`
- `IntegrationStatusCard`

These components should be built from shared primitives and tokens.

## Initial `shadcn/ui` install set

The first bootstrap should likely include:

- `button`
- `input`
- `textarea`
- `label`
- `form`
- `select`
- `dialog`
- `sheet`
- `dropdown-menu`
- `popover`
- `tooltip`
- `badge`
- `tabs`
- `separator`
- `avatar`
- `scroll-area`
- `skeleton`
- `table`
- `checkbox`
- `alert`

Install only what the first shell and initial screens actually need. The goal is a deliberate base, not a maximal bundle.

## First wave of customized primitives

The project should plan to customize early:

- `Button`
- `Input`
- `Textarea`
- `Badge`
- `Dialog`
- `Sheet`
- `Table`

These primitives shape the feel of the whole product quickly.

## Screen-by-screen bootstrap priorities

### 1. App shell

Build:

- sidebar
- page header
- search slot
- quick-add slot
- status slot

### 2. Contacts list shell

Build:

- filter bar
- contacts table or list
- empty state

### 3. Contact detail shell

Build:

- contact header
- notes area
- activity timeline
- sequence summary
- tasks summary

### 4. Queues

Build:

- due tasks list
- pending approvals list
- import warnings list

## Bootstrap quality bar

The frontend foundation is ready when:

- the app shell feels intentional, not placeholder
- tokens exist and are reused
- typography is coherent across screens
- the initial `shadcn/ui` components are visibly customized
- at least the shell and first two screens can be built without inventing new styling rules each time

## Related docs

- [Visual Design and Interaction Principles](./visual-design-and-interaction-principles.md)
- [Operator Model and Information Architecture](./operator-model-and-information-architecture.md)
- [Contact Workspace](./contact-workspace.md)
