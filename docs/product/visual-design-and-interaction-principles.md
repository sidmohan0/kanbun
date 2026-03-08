# Visual Design and Interaction Principles

## Purpose

This document defines how Kanbun should feel visually and interactively in the first implementation phase.

It is not a pixel-perfect design spec. It is the product-level visual direction that should guide implementation and future mockups.

## Design goal

Kanbun should feel:

- calm
- precise
- editorial
- high-trust
- operational without feeling cold

The product should reward long-term use by making dense information feel organized and intentional.

## What the interface should not feel like

Kanbun should avoid:

- generic SaaS dashboard styling
- bright sales-tool energy
- noisy card grids
- marketing-style visual fluff
- default template aesthetics

## Visual posture

The first phase should lean toward:

- restrained color
- strong typography hierarchy
- generous whitespace where decisions matter
- tighter density in operational lists and timelines
- a sense of crafted utility

## Typography direction

Typography should do more of the visual work than decorative chrome.

Principles:

- use a distinctive, readable primary type system
- make hierarchy obvious through size, weight, and spacing
- favor confident section titles and quiet supporting metadata
- avoid overly rounded, playful dashboard typography

## Color direction

The color system should be:

- neutral-forward
- warm or natural rather than neon
- accent-driven instead of rainbow-driven

Meaningful states should be easy to scan:

- action required
- healthy
- blocked
- warning
- muted history

State color should communicate status without turning the product into a Christmas tree.

## Surface and layout principles

### Contacts and detail pages

Contact pages should feel:

- grounded
- information-rich
- easy to scan top-to-bottom

The main relationship narrative should be more visually important than raw system metadata.

### Lists and work queues

Queues should optimize for:

- fast scanning
- sort and filter clarity
- obvious next action

Dense is acceptable. Chaotic is not.

### Settings and integrations

Settings should feel simpler and more utilitarian than core relationship views. Visual emphasis should stay on operational confidence and state clarity.

## Motion principles

Motion should be present but restrained.

Use motion for:

- page-load settling
- dialog and drawer entry
- list or timeline reveal
- state confirmation

Do not use motion for decoration alone.

## Interaction principles

The interface should:

- make important actions explicit
- keep context visible while editing
- prefer inline clarity over hidden menus where possible
- expose system state early, especially for imports, syncs, and pending sends

## Empty-state principles

Empty states should:

- explain what the area is for
- show the next useful action
- avoid sounding like placeholder boilerplate

## First-phase visual priorities

If there are implementation tradeoffs, prioritize these first:

- contact workspace clarity
- queue readability
- approval and due-state visibility
- polished typography and spacing
- coherent tokens across the app shell

## Related docs

- [Operator Model and Information Architecture](./operator-model-and-information-architecture.md)
- [Contact Workspace](./contact-workspace.md)
- [Sequences and Outbound Workflow](./sequences-and-outbound-workflow.md)
