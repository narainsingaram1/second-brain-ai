# Private hosted app

Live URL: https://synapse-narain-brain.coolfiregoon.chatgpt.site

Open this URL on each device and sign in with the same ChatGPT account. Tasks, goals, habits, journals, notes, and chat history are stored in the hosted D1 database. The page refreshes from the cloud on focus and every 15 seconds while visible and idle. Watch the sync status at the top before switching devices.

The desktop app and localhost app keep their existing local storage. To move their records, open the updated local app, click **Export data**, then click **Import data** on the hosted app. Import replaces the cloud snapshot; export first if the cloud already contains records you want to keep. Export omits the AI API key. Add your OpenRouter key in Settings separately on each device. No API key is embedded in the hosted build or stored in the cloud database.

Concurrent edits use revision checks. A stale save is rejected rather than overwriting newer records. If a conflict appears, export the unsaved work, reload to load current cloud records, then reapply the desired edits. This version requires a working connection to load cloud records and confirm saves; it does not merge offline edits automatically.

## Source and updates

The deployment checkout is `hosting/synapse`, a separate Sites source repository. The original application checkout is not committed or pushed by deployment. `.openai/hosting.json` inside the deployment checkout retains its exact Site ID. Preserve the private audience.

1. Make changes in the root application's `src` directory.
2. Run `npm test` and `npm run build` in the root checkout.
3. Run `node hosting/prepare-client.mjs` to copy application source into the deployment checkout. This copies an explicit file list, excluding environment files and local records.
4. In `hosting/synapse`, run the Sites dependency and build helpers, then its source workflow and private deployment tools. The build installs the copied client's locked dependencies and builds with cloud sync enabled and the build-time API key cleared.
5. For schema changes, update `hosting/synapse/db/schema.ts` and generate an additional migration with `npm run db:generate` before building. Existing migrations are immutable.

Only the hosted browser app syncs. The original Tauri app is not connected to cloud storage. Use the hosted URL on the Mac as well as other devices for one shared workspace.
