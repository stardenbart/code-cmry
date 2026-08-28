# CIA Multi-Chat Evidence Fallback Fix

**Goal:** Multi-Chat menjawab pertanyaan historis spesifik dari data live tanpa periode, KPI, kartu sumber, atau pesan kegagalan yang menyesatkan.

## Task 1: Normalize query period

- Add a regression test for `bulan Juni kemarin` resolving only to June 2026.
- Treat `kemarin` as a named-month qualifier and suppress overlapping relative-day matches.
- Run the period resolver tests.

## Task 2: Select only relevant evidence routes

- Add tests for equivalent visual bindings being collapsed into one route.
- Add a test that a non-causal ranking question does not expand into sibling correlation KPIs.
- Deduplicate routes using semantic identity rather than database binding IDs.
- Limit correlation expansion to questions that actually request causes/relationships.
- Run router, gap-analyzer, and orchestrator tests.

## Task 3: Preserve usable live evidence when synthesis fails

- Add tests for model errors/invalid output with successful live DAX evidence.
- Build a deterministic, human-readable answer from returned rows.
- Deduplicate and cap evidence sources while retaining internal warning telemetry.
- Deduplicate/cap the web adapter dashboard cards.
- Run synthesizer and adapter tests.

## Task 4: Improve user-facing evidence metadata

- Replace raw internal error-code output with one actionable, friendly status.
- Deduplicate/cap rendered sources defensively.
- Build the frontend.

## Task 5: Verify end to end

- Run all backend tests and the frontend production build.
- Restart the backend from the active workspace.
- Exercise the exact CMD1 June question and verify one June period, a live-data answer, and bounded unique sources.
- Commit only the CIA bug-fix files; preserve unrelated user changes.
