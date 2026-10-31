# Third-party components and notices

Kanbun's own code is licensed under [Apache-2.0](LICENSE). External dependencies retain their
respective licenses. The root `pnpm-lock.yaml` records the resolved dependency graph; each workspace
manifest records the dependencies it directly owns.

## Component inventory

The application uses React, Yjs, PartySocket, Zod, JOSE, Drizzle ORM, and fractional-indexing,
along with Cloudflare's platform interfaces. Development and verification use pnpm, TypeScript,
Vite, Vitest, Playwright, ESLint, Prettier, Wrangler, and the devcontainer toolchain.
The development container also installs Gitleaks, Vale, and OpenSSF Scorecard from pinned upstream
release archives. Their versions and archive checksums are recorded in `config/audit-tools.json`;
their upstream licenses apply to redistribution of those binaries.
This summary identifies major components. The lockfile and installed packages are the sources for
the complete transitive inventory and package-provided license texts. Preserve applicable notices
when redistributing a bundle, container image, or other release artifact. Release publication
requires an artifact-specific license and provenance review recorded through the
[launch-readiness process](docs/launch-readiness.md).

## Fonts

The web entry point requests **Inter** and **Shippori Mincho** from Google Fonts. Font requests are
made by the visitor's browser to Google's service. A deployment operator should account for that
external request in its privacy review. The repository's brand wordmarks use outlined lettering.

- [Inter source and license](https://github.com/rsms/inter)
- [Shippori Mincho source and license](https://github.com/fontdasu/ShipporiMincho)

Both font families use the SIL Open Font License. Preserve their upstream license and copyright
notices if adding self-hosted font files to a distribution.

## Original assets and provider assets

The logo masters, application marks, and styles are maintained in this repository. Product
screenshots used in public documentation must use synthetic fixtures and include capture
provenance. The official Cloudflare deployment badge is a provider-hosted asset linked from its
installation flow. Provider names identify the services Kanbun integrates with.

Contributors must identify third-party code or assets they introduce, retain required attribution,
and provide source and license information for review. See [CONTRIBUTING.md](CONTRIBUTING.md).
