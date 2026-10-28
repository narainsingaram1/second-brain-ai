# ✦ Synapse • AI Second Brain (Desktop & Native Client)

> Built with **Tauri v2 (Rust Core) + React 19 + TypeScript + Tailwind CSS**
> Designed faithfully to the hyper-tactile, fluid, neumorphic reference design.

---

## ⚡ Quick Start

### 1. Launch in Desktop Window (Native macOS App)
```bash
cd ~/Desktop/second-brain-ai
npm run tauri dev
```

### 2. Launch in Web Browser
```bash
cd ~/Desktop/second-brain-ai
npm run dev
```
Open [http://localhost:1420](http://localhost:1420) in your browser.

---

## Conversation and agent runtime

Home and Copilot open the same full-page chat. The welcome screen transitions into a single message viewport with a pinned composer. New chat archives the current thread; recent threads can be reopened from the welcome screen. Incoming replies preserve your reading position, and long answers open at their beginning with a **Latest** control to jump to the end. Task and goal citations display readable titles, and their inspectors show dates, status, progress and milestones.

Home and Copilot share a persistent conversation, selected model, progress indicator, and Stop control. The assistant can discuss a request, retrieve evidence, execute several actions, and inspect their results within one turn. The configured model must support function tools.

- `query_records` filters the complete live collection by type, status, date, section, or text. It returns exact counts and paginated results rather than a sample of tasks.
- `search_records` combines keyword search with neural passage search. Long records use overlapping passages; initial indexing batches passages through the embedding provider, and unchanged embeddings are cached in IndexedDB by account, model, and content hash. Searches derive candidates from current records, so deleted or edited content is not served from stale cache entries. Embedding failures explicitly degrade to keyword search.
- `read_record` and `recall_conversation` paginate full records and older messages. Answers can cite exact source IDs; expand **Sources** under an answer to inspect the current saved record.
- Mutation tools validate arguments and exact targets, await durable storage, and feed results back to the model. Successful identical calls within a turn are deduplicated. Cancellation and provider failures report any changes already saved; failed writes are not counted as successful.

Each turn is bounded to 48 model rounds, 96 tool calls, and four minutes. Model requests time out after 60 seconds. Long evidence is paginated and older tool bodies may be evicted from the prompt; the model can retrieve them again. Requests exceeding those limits report incomplete coverage. The runtime accesses the app's records; it does not fetch websites or ingest external files. The former cosmetic Web toggle has been removed.

Run `npm test` for deterministic runtime, retrieval, caching, validation, cancellation, persistence, and chat rendering checks. For browser layout checks, start `npm exec vite -- --config tests/fixtures/vite.config.ts` and open `http://127.0.0.1:1423/tests/fixtures/chat.html`. This fixture uses in-memory synthetic records and intercepted model responses; it does not load user records or call an external provider. Its separate Vite cache keeps tests from invalidating the running app’s dependencies. These tests mock provider responses and use synthetic records; they do not establish live provider compatibility. Run `npm run build` for TypeScript and production bundling checks.

---

## 🔑 Adding Your OpenRouter API Key

You can add your OpenRouter API key in **either of two convenient ways**:

### Method A: In-App Settings (Recommended)
1. Launch the app (`npm run tauri dev` or `npm run dev`).
2. Click the **"Add Key"** or **Settings Gear** icon in the top right navigation bar.
3. Paste your OpenRouter API key (`sk-or-v1-...`).
4. Click **"Test"** to verify live connection with OpenRouter.
5. Click **"Save Changes"**. Your key is securely persisted locally on your device in `~/.second_brain_ai/openrouter.key` and `localStorage`.

### Method B: Environment Variable (`.env`)
1. Open `.env` in `~/Desktop/second-brain-ai/.env`:
   ```env
   VITE_OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```
2. Restart the app.

---

## 🎨 Design & Features (Faithful to the Reference Design)

1. **Journeys & Flow Canvas (Centerpiece UI)**:
   - 4-column interconnected pipeline matching the reference layout:
     - **Intake & Morning Kickoff** ("New Case Management")
     - **Active Execution & Deep Work** ("Issue Identification")
     - **Technical Resolution & Polish** ("Technical Resolution")
     - **Next Actions & Habits** ("New Tasks" with tactile pill buttons)
   - Dynamic SVG cubic bezier curves (pink & blue connectors with anchor dots).
   - High-contrast black focus card: **"Request Processing"** with animated pointer arrow.
   - Interactive tasks with avatar assignments, checkmarks, calendar due dates, and 3-dot menus.

2. **Top Navigation Chrome**:
   - Brand mark (`synapse AI 2.0`)
   - Black pill active navigation tab switcher
   - Omnibar / browser URL pill input with `synapse://brain/search` and `⌘K` shortcut
   - Quick action buttons: AI Sparkle copilot trigger, Activity bell, Key status badge, Settings, User avatar.

3. **Left Floating Dock**:
   - Tactile vertical floating pill dock.
   - One-click navigation: Journeys, Tasks, Habits, Reflections, Knowledge Vault, AI Copilot.
   - `+` Quick Add action.
   - Tactile Day / Night dark mode toggle at the bottom.

4. **Dual Bottom Master Panels**:
   - **Suggested Knowledge**: Multi-column table with Subject, status pills (*Executed*, *Synthesized*, *Review*), Start/End dates, and assigned user avatars.
   - **Daily Habits & Streaks**: Today's completion ring, flame streak counters, quick checkoffs, and AI habit debrief.

5. **Task Matrix**:
   - Due date filters: *Today*, *Upcoming*, *Overdue*, *Completed*, *All*.
   - Priority sorting and life domain filtering.
   - **AI Auto-Breakdown**: Click *AI Breakdown* to decompose any complex goal into actionable subtasks via OpenRouter!

6. **Daily Habits Tracker**:
   - 7-day punch card grid with completion history.
   - Current streaks and all-time records.

7. **Reflective Journal**:
   - Daily mood tracker (Peak Energy, Great, Steady, Fatigued, Stressed).
   - Freeform journal entry + Daily Wins & Friction logs.
   - **AI Cognitive Synthesis**: Sends your daily logs, completed tasks, and habits to OpenRouter for a Stoic productivity coaching debrief.

8. **AI Copilot & Assistant**:
   - Context-aware chatbot with live visibility into your pending tasks, overdue items, habits, and journal reflections.
   - Quick prompt presets: *Prioritize Today's Due Dates*, *Analyze Habit Consistency*, *Strategic Day Review*.

9. **Native Rust Core Capabilities (`src-tauri/src/lib.rs`)**:
   - `save_brain_data` / `load_brain_data`: Native JSON persistence to `~/.second_brain_ai/`
   - `save_openrouter_api_key` / `get_openrouter_api_key`: Secure local file storage
   - `export_backup`: Direct export to your Desktop folder
