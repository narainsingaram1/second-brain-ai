# Synapse

## The assistant can change everything

Everything a user can create, edit or delete in the app, the assistant must be able to do from chat.
When you add a feature, a kind of data, or a field, ship its assistant support in the same change:

- **New kind of data** (a new record collection or preference): add create/update/delete tools in
  `src/services/brainTools.ts` (definition in the tool lists, logic in `prepareMutation`, and in
  `applyMutation`/`mutationRecords` if it isn't a plain record list). Add each tool to `INTERNAL` in
  `src/services/actionPolicy.ts`. Then list the collection in `COVERAGE` in `tests/ai-coverage.test.mjs`.
  Only exempt it there, with a reason, if the assistant truly must not touch it (settings, history, uploads).
- **New tracker field**: add it to `TRACKER_FIELDS` in `src/utils/trackerFields.ts`. The tracker tools
  pick it up automatically; the form should use the same list for its options.
- **New action** in an existing area (e.g. "archive"): add a tool or extend an existing one.
- Deletions and anything risky wait for the user's approval (`approvalReason`); never bypass it.

`npm test` fails if a stored collection, a tracker form field, or a change tool is missing assistant support.

## Server bundles

After changing anything under `server/` or code it imports from `src/`, run `npm run build:api` and commit
the regenerated `api/*.js` (the tests check they are current).
