# Public product images

`issue-list.png` is a Chromium capture of the actual React application with synthetic local REC
issues and the Alice fixture identity. It was captured on October 31, 2026 using the first
`@preflight` scenario in
[app.spec.ts](../../packages/verifier/test/recovery/app.spec.ts). The scenario creates issues
through the UI, checks convergence with a second browser, and retains light, dark, and narrow
screenshots in its Playwright attachments. The published image uses its light desktop view.

Regenerate the scenario inside the devcontainer, inspect the `product-ui-light` attachment for
private information and current layout, and copy that PNG to `issue-list.png`. Capture provenance
does not imply that the pictured source qualifies a later release; use the candidate's verifier
receipt for qualification.

The social preview is rendered from the original
[SVG master](../../brand/svg/social-og-1200x630.svg) to
[og.png](../../apps/web/public/og.png) with:

```sh
./scripts/devcontainer.sh exec node scripts/render-social-card.mjs
```

The renderer uses the repository's pinned Chromium dependency and local system fonts. Inspect the
result after changing artwork or rendering dependencies. No network font or image requests are
required by the social-card renderer.
