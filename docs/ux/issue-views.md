# Daily issue views

The issue list currently shows every active issue with its identifier, title, and save state.
Properties can be edited in the detail view, but there is no way to find assigned work, search the
list, narrow it by properties, or choose its ordering.

All issues remains the default destination. My Issues shows active issues assigned to the signed-in
person. Both views share the existing create form, title editing, issue detail links, synchronization
feedback, and archive Undo behavior. Creating an issue from My Issues assigns it to the current
person so the new work remains visible in that view.

A labelled toolbar searches visible issue identifiers, titles, and plain-text descriptions. Multiple
search words must all match. Optional status, assignee, priority, and label filters narrow the list;
My Issues fixes assignment to the current person. Filters combine rather than replacing one another.
A Clear filters action restores that view's defaults. Each view retains its own filters and ordering
while moving between views or opening and returning from an issue detail.

Ordering options are Manual order, Priority, Newest first, Recently updated, and Title. Urgent sorts
ahead of High, Medium, and Low; issues with no priority follow explicit priorities. Stable identifier
ties keep results predictable. Each title includes one compact, labelled status, priority, and
assignee summary alongside its existing identifier and save state. The same summary wraps on narrow
layouts without horizontal page overflow. Keeping this information in the title cell avoids three
extra table cells per issue in a large working set.

The result count distinguishes visible matches from the workspace total. An empty filtered view
explains that no issues match and offers Clear filters; an unfiltered empty workspace retains the
existing first-issue guidance. Archived and trashed issues stay outside active views.

Search and filters operate on the already authorized local working set. No new search service,
backend query, content logging, or telemetry is introduced. Actual browser verification measures a
5,000-issue bootstrap and first rendered working-set view against the specification's one-second
target. Seeding and cold module compilation are recorded separately from that boundary; rendering
changes are driven by the measured result rather than an arbitrary row limit.

## Measured rendering evidence

The same local workerd fixture creates 5,000 real issues through HTTP mutation batches of at most
500, warms the Worker and Vite modules, then opens a new browser context with empty IndexedDB.
Measurement starts at the first `/sync/bootstrap` fetch invocation and ends two animation frames
after React commits the working-set count and all 5,000 issue rows. Seeding, cold Vite compilation,
initial account/context resolution, and initial module loading are excluded. These are local
Chromium acceptance observations, not a production latency guarantee or a timing-based CI gate.

| Version                                                             | Bootstrap to paint | Bootstrap HTTP | Encoded bootstrap body | Actual DOM issue rows | One-second target |
| ------------------------------------------------------------------- | -----------------: | -------------: | ---------------------: | --------------------: | ----------------- |
| Existing title-only list                                            |           656.3 ms |        78.9 ms |          422,520 bytes |                 5,000 | Pass              |
| Separate status, priority, and assignee cells                       |         1,371.1 ms |        87.4 ms |          425,002 bytes |                 5,000 | Miss              |
| Compact metadata summary in title cell                              |           720.6 ms |        70.1 ms |          421,051 bytes |                 5,000 | Pass              |
| Standalone title and metadata spans, integrated full recovery suite |           818.4 ms |        80.5 ms |          430,660 bytes |                 5,000 | Pass              |

Fixture identifiers, timestamps, and generated rows differ between runs, accounting for small
response-size differences. The final integrated observation ran with the recovery suite's two browser workers. Its standalone
title span preserves exact title discovery while the adjacent metadata span supplies the accessible
properties summary; the DOM node count stays unchanged from the compact variant. The final row
summary removes 15,000 additional table cells while
retaining every property. No pagination cap or virtualization was required. The browser scale test
retains its structured receipt and verifies the full working-set row count; each subsequent run
reports whether its observed rendering time meets the specification target.

After integrating discussion and recovery, the complete suite passed all 34 browser cases. Its
scale observation was 1,047.3 ms while a deployment build was also running in the shared VM. A
controlled single-worker run of the same application code, without that competing build, measured
783.7 ms to paint all 5,000 rows, including 68.4 ms HTTP and a 422,971-byte encoded response. Both
observations are retained as evidence; the timing remains advisory because shared-runner load
changes it. The controlled observation meets the specification target.

The first GitHub Actions scale run ([41129277632](https://github.com/sidmohan0/kanbun/actions/runs/41129277632))
used about 15.6 seconds for HTTP seeding and another 7.4 seconds for the warm browser. Together with fixture startup, this consumed
23.8 seconds of the ordinary 30-second test budget before measurement. The view painted all 5,000
rows, but the test deadline interrupted the subsequent receipt collection. Its retained trace records
2,614 ms to paint, 273.1 ms HTTP, and 440,927 encoded bytes: that CI observation misses the one-second
target. The scale case uses Playwright's standard slow-test allowance for its substantial fixture and
trace work; the measured interval, 1,000 ms target, row-count assertion, and reported target result
remain unchanged. Successful fixture execution does not imply a passing performance observation.
