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
