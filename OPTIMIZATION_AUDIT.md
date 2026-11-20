# Optimization audit

Audit date: 2026-11-20, branch `academic-workspace`. Each finding lists where it is, the cause, the measured or
expected effect, and its status. Numbers come from `node scripts/retrieval-bench.mjs` (a synthetic workspace of
1,500 tasks, 500 long notes, 20 notes with 400 KB inline screenshots, and 400 memories), run against the code before
and after each change.

## Summary

| # | Area | Finding | Status | Measured effect |
|---|------|---------|--------|-----------------|
| 1 | Retrieval | Every search and record read pretty-printed **every** record to JSON, though search never reads it | Fixed | Search 24.2 → 11.1 ms |
| 2 | Retrieval | Typed lookups (`read_record`, `query_records`) built all record types, then filtered | Fixed | Task lookup 7.3 → 0.5 ms |
| 3 | Retrieval | Notes with inline images re-ran image hiding over megabytes of base64 on every call | Fixed | Note lookup 8.5 → 2.1 ms |
| 4 | Retrieval | Unchanged records were re-split into passages on every search | Fixed | Included in #1 |
| 5 | Retrieval | BM25 looked up term counts with `Array.indexOf` (linear in a passage's distinct terms) | Fixed | Included in #1 |
| 6 | Retrieval | Cosine similarity recomputed each stored vector's norm on every search | Fixed | About 1/3 fewer multiplies per neural search |
| 7 | Native | `load_brain_data`, `load_user_state`, `load_auth_database`, `export_backup` were synchronous Tauri commands, so they ran on the main (window) thread | Fixed | UI no longer blocks while a large workspace file is read at startup |
| 8 | Dead code | Rust vector-vault commands (`save/search/delete_vector_chunks…`, stats, clear) and `greet` had no callers; save was O(n·m) and rewrote the whole file | Removed | −200 lines Rust |
| 9 | Memory | `normalizeAgentMemory` revalidates the whole memory at 35 call sites | Measured, not changed | 0.6 ms per call: negligible next to a model round trip |
| 10 | Server | Embedding upserts run in sequential batches of 100, and their errors are ignored | Open | See below |
| 11 | Server | Course document text is fetched in sequential batches of 50 | Open | See below |
| 12 | Memory | When memory is full, `makeRoom` re-serializes all of memory after each removal | Open (rare path) | See below |
| 13 | Native | Legacy `~/.second_brain_ai/vector_vault.json` stays on disk after the vault was dropped | Open | Disk only |

## Fixed

### 1–4. Record derivation in retrieval (`src/services/brainRetrieval.ts`)
- **Cause:** `records()` built `text: JSON.stringify(data, null, 2)` for every record each time it was called.
  `passages()` calls it on every `search_records` call and in every search box. It only reads `index` (the prose),
  so the JSON was thrown away. Typed reads also built every other record type, then filtered. Note image hiding
  and passage splitting were redone for every record on every call.
- **Fix:**
  - `text` is now a lazy getter, so the JSON is built only for records that are actually read.
  - Only the requested type is built.
  - The image-hidden copy of a note is cached per note object.
  - The passages of a record are cached per record object.
  - Both caches check the content they were derived from (note content; record prose and title). An edit is
    always picked up, including an edit made in place.
- **Verified:** existing tests for edits, deletions, and the cache refreshing after edits all pass. A new test in
  `tests/performance.test.mjs` covers passage reuse, replaced and in-place edits, typed lookups, and lazy JSON text.

### 5–6. Scoring (`brainRetrieval.ts`)
- `termCounts` keeps its term → count `Map` (`lookup`), so BM25 does a constant-time lookup. The array form still
  works for counts built elsewhere.
- Vector norms are cached in a `WeakMap` keyed by the vector, so each passage vector's norm is computed once.

### 7–8. Native commands (`src-tauri/src/lib.rs`)
- In Tauri 2, a synchronous command runs on the main thread, which also drives the window. The four file-reading
  commands are now `async` and run through `off_main` (`spawn_blocking`), as the save commands already did.
  `load_auth_database` reads directly, without checking `exists()` first; the result is the same.
- The vector-vault commands, `VectorChunk`/`SearchResult`/`VaultStats`, and `greet` were removed. No JS calls them:
  search moved to `brainRetrieval.ts`, and `dropLegacyVault()` clears the old IndexedDB copy.
- **Verified:** `cargo check` is clean with no warnings; `cargo test` passes 26 tests.

## Tried and reverted

### 9. Memoizing `normalizeAgentMemory`
A cache keyed by object identity made repeat calls free, but it returned stale results when memory was edited in
place, and three existing tests do exactly that. Each call costs only about 0.6 ms with 400 memories, so the
change was reverted rather than built on the assumption that state is never edited in place. The existing
identity cache in `storage.ts` (save path only) is unchanged.

## Open (not changed in this pass)

- **10. `server/lib/store.ts:157`:** `putMany` awaits each 100-row upsert in turn and ignores `error`. Running
  them in bounded parallel (like `getMany` at :146) would cut indexing time for large accounts. A failure should
  at least be logged.
- **11. `server/lib/store.ts:233`:** document-text batches of 50 are fetched one after another; they could run in
  bounded parallel.
- **12. `src/services/agentMemory.ts:385`:** `makeRoom` calls `memoryBytes` (a `JSON.stringify` of up to
  256 KB) after removing each entry. Tracking a running size would make it linear. It only runs when memory is full.
- **13.** The app could delete the legacy `vector_vault.json` once. This was left alone because it deletes a file
  on the user's disk.
- **Minor:** `agentDispatcher.ts:862` serializes each read result three times to build its dedupe key, and
  `brainRetrieval.ts:126` scans all tasks once per course (`courseTasks`). Both are small next to a model call.

## Checked and already sound

- **Saves:** the first save is immediate and later edits are merged into one trailing write after 400 ms
  (`App.tsx:387`, `persistLatestBrainState`). Normalization is cached by identity. The IndexedDB mirror waits
  for idle time. An emergency snapshot is written only on unload.
- **Model calls:** prompt caching places cache breakpoints on the stable prefix (`openrouter.ts:86`). Replies
  stream. Streamed text and activity updates are batched per animation frame (`useBrainConversation.ts:358`).
- **Agent loop:** independent reads run in parallel batches with in-flight dedupe and a per-turn read cache.
  There are step, tool and time budgets, and a stagnation breaker. Old tool bodies are evicted in one go at 140k
  characters, so the cached prefix breaks once (`agentDispatcher.ts:411`). Tool outputs are capped: `read_record`
  at 12k characters, query pages at 40 records, search pages at 6.
- **Indexes:** conversation search and memory recall keep incremental inverted indexes. Embedding lookups are
  batched into one IndexedDB transaction or bounded database queries. IndexedDB connections are opened once.
- **Polling:** cloud refresh runs every 15 s, is skipped while the page is hidden or a reply is running, and is
  cleaned up on unmount. Other intervals are per-component UI clocks that are cleared on unmount.

## Not covered in depth

Rendering in the large views (`WorkspacesView.tsx`, `TaskMatrixView.tsx`, `DailyPlannerView.tsx`), the browser
extension (`extension/page-agent.js`), and `lectureRecorder.ts` were only skimmed. A React Profiler pass on a
large workspace is the next step for the frontend.

## Verification

- `npm run typecheck`: clean
- `npm test`: 434/434 pass (433 existing + 1 new)
- `npm run build:api`: bundles regenerated (`api/agent.js`, `api/routines.js`, `api/telegram.js` import retrieval)
- `cargo check` / `cargo test` in `src-tauri`: clean / 26 passed
- `node scripts/retrieval-bench.mjs`: numbers above
