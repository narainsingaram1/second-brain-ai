# Optimization audit

Updated 2026-11-20 on branch `academic-workspace`. This file ranks the optimization work that is **still left**.
Rows marked **Done** shipped in Batch 1; see "Batch 1 results" below. Earlier work (commit `943fbc5`) is
summarized at the end.

Each impact figure is either **measured** (by a script, named where it is used) or **estimated** (worked out from
the code; the reasoning is given). Severity:
- **P0:** breaks or degrades for every user today. None were found.
- **P1:** a large, repeated cost on a common path.
- **P2:** a real cost that is bounded, rare, or small.

## System architecture and hot paths

```
User types in chat (ChatWorkspace.tsx)
  └─ useBrainConversation.ts: runs the turn; streamed text and steps are batched per animation frame (:358)
       └─ agentDispatcher.ts AutonomousBrainAgent
            ├─ boundedMessages (:333): system prompt + last ~48k chars of chat + per-turn context
            │     (lifeSnapshot, memoryContext, referenced records)
            ├─ openrouter.ts queryOpenRouterWithTools: prompt-cache breakpoints (:86), streaming SSE
            ├─ tool loop (:677): step/tool/time budgets; parallel read batches; tool bodies evicted at 140k chars
            │     ├─ read tools → brainTools.ts → brainRetrieval.ts
            │     │     (records → passages → BM25 + embeddings, fused by rank)
            │     ├─ memory tools → agentMemory.ts (inverted indexes over memories and archived chats)
            │     └─ write tools → prepareMutation → approval gate → commit
            └─ after the turn: memoryLearning.ts, one extra FAST_MODEL call to learn from the turn
  └─ New state → App.tsx setState → React re-render
       └─ Save effect (App.tsx:376): first save immediate, then one trailing save per 400 ms
            └─ storage.ts persistNow (:818)
                 ├─ Hosted account: cloudSync → recordSync.ts
                 │     (changed records only, plus the whole preferences blob)
                 ├─ Desktop: JSON.stringify(whole workspace) → Tauri IPC → lib.rs save_brain_data
                 │     (rewrites the whole file and fsyncs it) → IndexedDB mirror when idle
                 └─ Web: IndexedDB put (a structured clone of the whole workspace)
  └─ Cloud refresh every 15 s (App.tsx:347): preference revision check, then record deltas since the last seq
```

## Ranked remaining work

| Rank | Sev | Category | Where | Root cause | Impact | Fix |
|---|---|---|---|---|---|---|
| **1** | Done | Network / sync | `src/services/recordSync.ts:147-158`, `src/services/supabaseBrain.ts:90`, `src/App.tsx:468` | `savePreferences` detects which preference keys changed, then uploads **every** key: the active `chatHistory`, `auditLog`, `taskAppearance` and the rest. Every edit adds an audit entry, so every task toggle, rename or drag re-uploads the whole active chat. After a successful save it serializes every key a second time (:157). | **Estimated:** one full upload of the active chat per edit. That is ~100 KB–1 MB for a long chat (messages plus stored steps and sources), on top of the small record delta. The server rewrites the same jsonb row each time. | Send only `changed` keys. Change the `save_brain_prefs` RPC to merge them (`state = state \|\| p_state`) under the same revision check. Reuse the strings from `json` at :149 instead of serializing again. |
| **2** | P1 | Frontend / render | `src/components/ChatWorkspace.tsx:306-314`, `src/components/MarkdownView.tsx:13`, `src/components/ConversationMessage.tsx` | While a reply streams, `ChatWorkspace` re-renders every frame, and so does every past message. `ConversationMessage` gets the whole `state` and a new inline `actions` object, so `React.memo` cannot skip it. `MarkdownView` re-parses its markdown with regexes on every render. `visible.slice(0, index).some(...)` makes the list O(n²) on each render. | **Estimated:** a 60-message chat re-parses ~60 markdown documents per frame while a reply streams, for the whole reply. On slower machines this shows up as stream jank and high CPU. | Memoize `MarkdownView`'s parse (`useMemo` on `content`). Wrap `ConversationMessage` in `React.memo`, with stable callbacks (`useCallback`) and only the slices of `state` it reads. Compute the first user index once instead of slicing per message. Verify with React Profiler. |
| **3** | P1 | AI / tokens | `src/services/agentDispatcher.ts:334-359`, `src/services/openrouter.ts:86` | Chat history is the newest ~48k chars. Once a chat is longer than that, each new turn drops the oldest message, so the history that starts the prompt changes **every turn**. The cache breakpoint on the history then never matches the previous turn. | **Estimated:** for chats past ~48k chars (~12k tokens), up to ~12k history tokens per turn are written to cache again (1.25× input price) instead of read from it (0.1×), about 12× the cost of that part of the prompt. Time to first token also rises. | Move the window's start in large steps. When history overflows, drop down to ~32k in one go, aligned to a message boundary that stays fixed until the next overflow (for example, round the start index to a multiple of 8 messages). The prefix then breaks once every several turns, not every turn. |
| **4** | Done | Storage / I/O | `src/services/noteImageStore.ts:136` (`externalizeInlineImages`, never called), `src/services/brainRetrieval.ts` (image hiding) | New images go to the image store, but notes saved before that still hold inline base64 images. The migration function exists and nothing calls it. Those bytes ride along in every save, every cloud upload of the note, and every assistant read. | **Measured** (`save-cost.mjs`, scratchpad): 20 legacy notes with one 400 KB image each push one desktop save's serialization from ~3 MB to 10.9 MB (7.6 ms of `JSON.stringify` plus the IPC copy and a 10.9 MB fsync'd write). How much this matters depends on how many legacy notes users have; not measured. | Run `externalizeInlineImages` once per note on load (idle-time, in batches) and save the rewritten note. The image-hiding code in retrieval can then be removed later. |
| **5** | P2 | Storage / I/O | `src/services/storage.ts:855`, `src-tauri/src/lib.rs:53` | Every desktop save serializes the whole workspace, copies it over IPC, and rewrites and fsyncs the whole file. Saves run at most every 400 ms while editing. | **Measured:** ~3 MB per save for 1,500 tasks and 500 notes (without legacy images). Write amplification is roughly workspace size divided by edit size. | First, a longer trailing delay on desktop (for example 1.5 s; the emergency snapshot already covers closing). Longer term, one file per collection, so only changed collections are written. |
| **6** | Done | Server / DB | `server/lib/store.ts:157` | `putMany` awaits each 100-row embedding upsert one at a time and **ignores errors**. | **Estimated:** indexing N passages takes N/100 sequential round trips. Failed writes are silently re-embedded on a later search, which repeats paid embedding calls. | Run in bounded parallel (like `getMany` at :146), and log or throw on `error`. |
| **7** | Done | Server / DB | `server/lib/store.ts:233` | Course document text is fetched in sequential batches of 50. | **Estimated:** N/50 round trips before the first read tool runs in a server-agent turn. | Fetch the batches in bounded parallel. |
| **8** | P2 | Memory | `src/services/agentMemory.ts:385` | When memory is full, `makeRoom` re-serializes all of memory (up to 256 KB) after **each** removed entry. | O(k × 256 KB) for k evictions. Runs only when memory is full. | Track the running byte size and subtract each removed entry's size. |
| **9** | P2 | AI loop / CPU | `src/services/agentDispatcher.ts:862` | Each read call builds its dedupe key with stringify, then parse, then a canonical stringify of the whole output. | Three passes over each result (results are capped at ~12k chars). Small next to a model call. | Run one canonical stringify with the replacer that drops the offset fields. |
| **10** | P2 | Retrieval / CPU | `src/services/brainRetrieval.ts:126` | `courseTasks` scans every task once per course, on every search. | O(courses × tasks) per search. | Group tasks by course once per call. |
| **11** | P2 | Cleanup | `~/.second_brain_ai/vector_vault.json` | The old native vector vault file is left on disk; nothing reads it since the commands were removed. | Disk only. | Delete it once on startup. This deletes a file on users' machines, so it needs your OK. |
| **12** | P2 | Native | `src-tauri/src/lib.rs:79` | `save_openrouter_api_key` is still a synchronous command, so it runs on the main thread. | A tiny write, done rarely. | Make it `async` through `off_main` for consistency. |
| **13** | Done | Sync correctness | `src/services/recordSync.ts` (`savePreferences` conflict path, and the preference merge in `refresh`) | Found while testing Batch 1; it predates it. After a preference save conflicts, the engine records the other device's values as saved but leaves this device's local values unchanged. `refresh` then sees each local value differ from the recorded one, treats it as an unsaved local edit, and the next save sends it back. Example: device B changes the theme, device A saves any other preference at the same time, and A's next save restores A's old theme. | A preference changed on one device can be undone by another that saved at the same moment. Data, not speed. | After a conflict, apply the remote values for keys this device didn't change to local state (or record this device's previous JSON for them, so `refresh` adopts the remote value). Add a two-device test. |

**Not yet profiled:** rendering in `WorkspacesView.tsx` (1,765 lines, no memoization at all), `TaskMatrixView.tsx`,
and `JournalView.tsx`, the browser extension (`extension/page-agent.js`), and
`lectureRecorder.ts`. Any of these could hold findings that rank above #5. A React Profiler pass on a large
workspace should come before Batch 4.

## Phased execution plan

Each batch can ship on its own, passes `npm test`, typecheck and `cargo check`, and adds a test or benchmark for
what it changes.

- **Batch 1: sync and storage (#1, #4, #6, #7). Done; see "Batch 1 results".**
- **Batch 2: agent loop and tokens (#3, #9)**
  - Stepped history window. Test that the history prefix is byte-identical across consecutive turns until the
    next step. Measure cache reads vs. writes with `npm run bench:model`.
  - Single-pass dedupe key.
- **Batch 3: native and I/O (#5, #12, #11)**
  - Longer desktop save delay, `async` key save, and (with your OK) legacy vault file cleanup.
  - Later: per-collection files.
- **Batch 4: frontend (#2, then the profiling pass)**
  - Memoize `MarkdownView` and `ConversationMessage`; remove the O(n²) slice. Confirm with React Profiler on a
    60-message chat while a reply streams.
  - Profile the large views and add whatever ranks high to this table.
- **Batch 5: small cleanups (#8, #10)**

## Batch 1 results

- **#1 Preference saves send only changed fields.**
  - The new migration `supabase/migrations/202611200001_prefs_patch.sql` adds `save_brain_prefs_patch(changes,
    removed, revision)`, which merges the fields under the same revision check. `save_brain_prefs` stays for
    clients that loaded before the migration.
  - `RecordSync` sends only the changed keys, plus any keys this device dropped. If the database lacks the new
    function (PGRST202/42883), it falls back to whole-preference saves.
  - Test (`tests/record-sync.test.mjs`): a task edit uploads only `auditLog`, and the 30-message chat stays on the
    server untouched. Also covered: a conflict merges with the other device's change, a dropped field is removed,
    and an old database still gets whole saves.
  - **Deploy step:** apply the migration to Supabase. Until then, clients keep using whole saves.
- **#4 Legacy inline images.** `migrateInlineNoteImages` (`src/services/noteImageStore.ts`) runs after load and
  rewrites one note per idle moment.
  - On hosted accounts, an image is replaced only after its cloud copy is confirmed, so other devices never see a
    missing image. Otherwise it stays inline and is retried on the next load.
  - A note edited meanwhile is left alone; the editor's own pass handles it when the note is opened.
  - Test in `tests/notes.test.mjs`.
- **#6, #7 Server batches.** Embedding upserts and document fetches run 4 at a time (`inBatches` in
  `server/lib/store.ts`). A failed embedding write is now logged instead of silently dropped. It still doesn't
  fail the search, since it is only a cache miss.
- **Verified:** typecheck is clean; `npm test` passes 436/436 (2 new tests); `cargo check` is clean; API bundles
  are regenerated. One run of the full suite failed "the learner batches turns…" once. It passed 5/5 in
  isolation with these changes, 3/3 without them, and on the next full run, so it is timing-sensitive under load
  and not caused by Batch 1.

## #13 fix: preference conflicts

- **Cause** (`src/services/recordSync.ts`, `savePreferences`), in two parts:
  - After a conflict, the engine recorded the other device's values as last-saved for fields this device hadn't
    changed. Local state still held the old values, so `refresh` took them for unsaved local edits and the next
    save sent them back.
  - For a field both devices changed, `refresh` compared against the other device's pre-merge value. That would
    have shown the losing value locally while the server kept this device's value.
- **Fix:**
  - Unchanged fields keep their last-saved JSON, so `refresh` sees them as unedited and adopts the other device's
    values.
  - `refresh` applies the merged result (the other device's state plus this device's changes).
- **Test** (`tests/record-sync.test.mjs`): two devices change different fields and one shared field at the same
  time, on both the patch and full-save paths. The checks:
  - The server keeps both changes, and the last save wins the shared field.
  - After a refresh, each device shows the merged result.
  - A later, unrelated save does not undo the other device's change.
  - The test failed before the fix (device A kept its old theme) and passes after.
- **Verified:** typecheck is clean; `npm test` passes 437/437; API bundles are regenerated.

## Already done (commit `943fbc5`)

Measured with `npm run bench:retrieval`, before → after:
- **Retrieval:** search 24.2 → 11.1 ms; task lookup 7.3 → 0.5 ms; note lookup 8.5 → 2.1 ms.
  - Record JSON is built only when it is read, and only the requested record type is built.
  - The image-hidden copy of a note and each record's passages are cached, checked against their content.
  - BM25 looks up term counts in constant time, and vector norms are cached.
- **Native:** the startup file reads (`load_brain_data`, `load_user_state`, `load_auth_database`) and
  `export_backup` run off the main thread. The dead vector-vault commands and `greet` were removed.
- **Tried and reverted:** memoizing `normalizeAgentMemory`. It went stale when memory was edited in place, and it
  saved only 0.6 ms per call.
- **Checked and already sound:** save coalescing; prompt-cache layout within a turn; tool routing by area; parallel
  read batches with dedupe; tool output caps; incremental indexes for memory and archived chats; record-level
  cloud deltas; per-frame stream batching; cleanup of polling timers.
