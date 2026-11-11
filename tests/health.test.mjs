import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
import { pgStore } from './helpers/pgStore.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-health-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { parseHealthPayload, applyHealthPatches, mergeHealthDay, normalizeHealthDay } = await load('/src/utils/health.ts');
const { computeHealth, workoutLoad, healthSummaryForAssistant } = await load('/src/utils/healthMetrics.ts');
const { sampleHealthDays } = await load('/src/utils/healthSample.ts');
const { prepareMutation, applyMutation, executeRead } = await load('/src/services/brainTools.ts');
const { approvalReason } = await load('/src/services/actionPolicy.ts');
const { healthSyncHandlers } = await load('/server/routes/healthsync.ts');
const { HttpError } = await load('/server/lib/http.ts');
const { PreferencesConflict } = await load('/src/services/recordSync.ts');

const hae = {
  data: {
    metrics: [
      { name: 'step_count', units: 'count', data: [{ date: '2026-11-07 00:00:00 -0500', qty: 9000 }, { date: '2026-11-08 00:00:00 -0500', qty: 4000 }, { date: '2026-11-08 13:00:00 -0500', qty: 1500 }] },
      { name: 'active_energy', units: 'kJ', data: [{ date: '2026-11-08 00:00:00 -0500', qty: 2092 }] },
      { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-11-08 00:00:00 -0500', qty: 54 }] },
      { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-11-08 00:00:00 -0500', qty: 70 }, { date: '2026-11-08 03:00:00 -0500', qty: 60 }] },
      { name: 'weight_body_mass', units: 'lb', data: [{ date: '2026-11-08 07:00:00 -0500', qty: 160 }] },
      { name: 'blood_oxygen_saturation', units: '%', data: [{ date: '2026-11-08 00:00:00 -0500', qty: 0.97 }] },
      { name: 'heart_rate', units: 'count/min', data: [{ date: '2026-11-08 00:00:00 -0500', Min: 48, Avg: 70, Max: 171 }] },
      { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-11-08 00:00:00 -0500', asleep: 0, core: 4.5, deep: 1, rem: 1.5, awake: 0.25, inBed: 7.5,
        sleepStart: '2026-11-07 23:30:00 -0500', sleepEnd: '2026-11-08 07:00:00 -0500' }] },
      { name: 'unknown_metric', units: 'x', data: [{ date: '2026-11-08', qty: 1 }] },
    ],
    workouts: [{ id: 'w1', name: 'Outdoor Run', start: '2026-11-08 17:00:00 -0500', end: '2026-11-08 17:40:00 -0500', duration: 2400,
      activeEnergyBurned: { qty: 400, units: 'kcal' }, distance: { qty: 5, units: 'mi' }, heartRate: { avg: { qty: 150 }, max: { qty: 175 } } }],
  },
};

test('reads Health Auto Export JSON into days, converting units and staging sleep to the wake date', () => {
  const days = parseHealthPayload(hae);
  assert.deepEqual(days.map(d => d.date), ['2026-11-07', '2026-11-08']);
  const d = days[1];
  assert.equal(d.metrics.steps, 5500);
  assert.equal(d.metrics.activeKcal, 500);
  assert.equal(d.metrics.hrv, 65);
  assert.equal(d.metrics.weightKg, 72.6);
  assert.equal(d.metrics.spo2, 97);
  assert.equal(d.metrics.maxHr, 171);
  assert.equal(d.metrics.sleepMin, 420, 'asleep 0 falls back to core + deep + rem');
  assert.equal(d.metrics.deepMin, 60);
  assert.equal(d.sleepStart, '2026-11-07 23:30');
  assert.equal(d.sleepEnd, '2026-11-08 07:00');
  assert.deepEqual(d.workouts, [{ id: 'w1', type: 'Outdoor Run', start: '2026-11-08 17:00', minutes: 40, energyKcal: 400, distanceKm: 8.05, avgHr: 150, maxHr: 175 }]);
});

test('reads per-stage sleep samples and the simple Shortcut shape', () => {
  const stages = parseHealthPayload({ data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data: [
    { startDate: '2026-11-07 23:00:00 -0500', endDate: '2026-11-08 02:00:00 -0500', value: 'Core' },
    { startDate: '2026-11-08 02:00:00 -0500', endDate: '2026-11-08 03:00:00 -0500', value: 'Deep' },
    { startDate: '2026-11-08 03:00:00 -0500', endDate: '2026-11-08 03:15:00 -0500', value: 'Awake' },
    { startDate: '2026-11-08 03:15:00 -0500', endDate: '2026-11-08 06:45:00 -0500', value: 'REM' },
  ] }] } });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].date, '2026-11-08');
  assert.equal(stages[0].metrics.sleepMin, 450);
  assert.equal(stages[0].metrics.awakeMin, 15);
  assert.equal(stages[0].sleepStart, '2026-11-07 23:00');
  const simple = parseHealthPayload({ date: '2026-11-08', steps: '8123', restingHr: 52, sleepHours: 7.25, hrv: 9999 });
  assert.deepEqual(simple[0].metrics, { steps: 8123, restingHr: 52, sleepMin: 435 }, 'implausible HRV is dropped');
  assert.throws(() => parseHealthPayload({ hello: 'world' }), /No Apple Health data/);
});

test('a repeated sync changes nothing, and syncs never touch tags or notes', () => {
  const patches = parseHealthPayload(hae);
  const first = applyHealthPatches([], patches, 'Health Auto Export', '2026-11-08T12:00:00Z');
  assert.equal(first.changed.length, 2);
  const tagged = first.days.map(d => d.date === '2026-11-08' ? { ...d, tags: ['alcohol'], note: 'Party' } : d);
  const again = applyHealthPatches(tagged, patches, 'Health Auto Export', '2026-11-08T13:00:00Z');
  assert.equal(again.changed.length, 0);
  const newer = mergeHealthDay(tagged[1], { date: '2026-11-08', metrics: { steps: 12000 } }, 'Health Auto Export');
  assert.equal(newer.metrics.steps, 12000);
  assert.equal(newer.metrics.restingHr, 54);
  assert.deepEqual(newer.tags, ['alcohol']);
  assert.equal(newer.note, 'Party');
  assert.equal(normalizeHealthDay({ date: '2026-02-30', metrics: {} }), undefined);
});

test('metrics: recovery against your own baseline, training load, sleep debt and tag effects', () => {
  const today = '2026-11-09';
  const days = sampleHealthDays(today, 75);
  const h = computeHealth(days, { sleepGoalMin: 480 }, today);
  assert.equal(h.dayCount, 75);
  assert.ok(h.recovery && h.recovery.score >= 0 && h.recovery.score <= 100);
  assert.deepEqual(h.recovery.components.map(c => c.key).slice(0, 2), ['hrv', 'restingHr']);
  assert.ok(h.training.fitness > 0 && h.training.ratio > 0.3 && h.training.ratio < 3);
  assert.ok(h.sleep.debtMin > 0, 'sample sleeps less than 8 hours');
  assert.ok(h.sleep.regularity.score > 0);
  const alcohol = h.tagEffects.find(t => t.tag === 'alcohol');
  assert.ok(alcohol, 'alcohol shows up as a tag effect');
  assert.ok(alcohol.effects.find(e => e.key === 'hrv').diffPct < 0, 'HRV is lower the morning after');
  assert.equal(h.series.length, 75);

  // A clearly bad morning scores lower than a clearly good one.
  const base = days.slice(0, -1);
  const last = days[days.length - 1];
  const good = computeHealth([...base, { ...last, metrics: { ...last.metrics, hrv: 95, restingHr: 50, sleepMin: 500 } }], undefined, today).recovery.score;
  const bad = computeHealth([...base, { ...last, metrics: { ...last.metrics, hrv: 30, restingHr: 66, sleepMin: 300 } }], undefined, today);
  assert.ok(good > 70 && bad.recovery.score < 30, `good ${good}, bad ${bad.recovery.score}`);
  assert.ok(bad.strain.length >= 1, 'HRV down with resting HR up raises a strain signal');

  assert.ok(workoutLoad(60, 160, 55, 190) > workoutLoad(60, 120, 55, 190));
  assert.equal(computeHealth([], undefined, today).dayCount, 0);

  // Computing health for a specific selected past date anchors insights to that day.
  const pastDay = '2026-11-05';
  const pastInsights = computeHealth(days, { sleepGoalMin: 480 }, pastDay);
  assert.equal(pastInsights.today, pastDay);
  assert.ok(pastInsights.dayCount < 75);
  assert.equal(pastInsights.recovery?.date, pastDay);
});

const emptyState = () => ({ userId: 'u', tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], workspaces: [], noteFolders: [],
  sections: ['Academic'], subsections: { Academic: ['General'] }, chatHistory: [], openRouterKey: '', selectedModel: '', theme: 'light', healthDays: [],
  study: { courses: [], folders: [], documents: [], decks: [], quizzes: [] } });

test('the assistant can log, correct, delete and read health data, and change targets', async () => {
  let s = emptyState();
  let m = prepareMutation('log_health_day', { date: '2026-11-08', sleepMin: 410, tags: ['Late Caffeine'], note: 'Coffee at 6 PM' }, s);
  s = applyMutation(s, m);
  assert.equal(s.healthDays[0].metrics.sleepMin, 410);
  assert.deepEqual(s.healthDays[0].tags, ['late caffeine']);
  m = prepareMutation('update_health_day', { date: '2026-11-08', clearMetrics: ['sleepMin'], restingHr: 55, removeTags: ['late caffeine'], addTags: ['travel'] }, s);
  assert.deepEqual(m.expected, s.healthDays[0]);
  s = applyMutation(s, m);
  assert.deepEqual(s.healthDays[0].metrics, { restingHr: 55 });
  assert.deepEqual(s.healthDays[0].tags, ['travel']);
  assert.throws(() => prepareMutation('log_health_day', { date: '2026-11-08', restingHr: 500 }, s), /between/);
  assert.throws(() => prepareMutation('update_health_day', { date: '2026-01-01', steps: 5 }, s), /No health data/);
  assert.match(approvalReason('delete_health_day', { untrustedRead: false, changes: 0, askBeforeChanges: false }), /approval/);
  s = applyMutation(s, prepareMutation('delete_health_day', { date: '2026-11-08' }, s));
  assert.equal(s.healthDays.length, 0);

  assert.throws(() => prepareMutation('update_health_profile', { stepGoal: 9000 }, s), /no Health workspace/);
  s = applyMutation(s, prepareMutation('create_workspace', { name: 'Health', template: 'health' }, s));
  assert.equal(s.workspaces[0].color, 'rose');
  s = applyMutation(s, prepareMutation('update_health_profile', { sleepGoalHours: 7.5, stepGoal: 10000 }, s));
  assert.deepEqual(s.workspaces[0].health, { sleepGoalMin: 450, stepGoal: 10000 });
  s = applyMutation(s, prepareMutation('update_health_profile', { clear: ['stepGoal'] }, s));
  assert.deepEqual(s.workspaces[0].health, { sleepGoalMin: 450 });

  s = { ...s, healthDays: sampleHealthDays('2026-11-09', 40) };
  const summary = (await executeRead('health_summary', { date: '2026-11-09' }, s, '')).output;
  assert.equal(summary.available, true);
  assert.equal(summary.sleep.goal, '7h 30m');
  const rows = (await executeRead('query_records', { type: 'health', dateFrom: '2026-11-01', dateTo: '2026-11-09' }, s, '')).output;
  assert.equal(rows.total, 9);
  assert.equal(healthSummaryForAssistant([], undefined).available, false);
});

/** Service-role lookups over the same tables, as the real admin store does. */
function admin(db, store) {
  let sessions = 0;
  return {
    sessions: () => sessions,
    async healthAccount(hash) { await db.exec('reset role'); const r = (await db.query('select user_id from public.health_sync_tokens where token_hash = $1', [hash])).rows[0]; return r?.user_id ?? null; },
    async healthDays(userId, ids) { await db.exec('reset role'); return (await db.query("select id, data, revision from public.brain_records where user_id = $1 and collection = 'healthDays' and not deleted and id = any($2)", [userId, ids])).rows.map(r => ({ ...r, revision: Number(r.revision) })); },
    async markHealthSync(userId, days, source) { await db.exec('reset role'); await db.query('update public.health_sync_tokens set last_sync_at = now(), last_sync_days = $2, last_sync_source = $3 where user_id = $1', [userId, days, source]); },
    async session() { sessions++; return { store: { records: { saveRecords: async changes => { await asOwner(); return store.records.saveRecords(changes); } } }, close: async () => {} }; },
  };
}
let asOwner;

test('the phone pushes data with its token; the app sees it; tokens can be replaced and revoked', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  asOwner = () => asUser(owner);
  await asOwner();
  await db.query('select public.save_brain($1::jsonb, 0, $2::uuid)', [JSON.stringify({ tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], chatHistory: [], sections: ['A'], subsections: { A: ['General'] } }), owner]);
  const store = pgStore(db, owner, PreferencesConflict, HttpError);
  assert.equal(await store.records.migrate(), 'records');
  const adminStore = admin(db, store);
  const handlers = healthSyncHandlers({ caller: async () => { await asOwner(); return { userId: owner, store }; }, secretsKey: () => '', admin: () => adminStore }, () => 'https://synapse.example');
  const signedIn = (method, body) => new Request('https://synapse.example/api/healthsync', { method, headers: { Authorization: 'Bearer eyJsigned.in.user' }, body });
  const phone = (token, body) => new Request('https://synapse.example/api/healthsync', { method: 'POST', headers: { 'x-health-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  let status = await (await handlers.GET(signedIn('GET'))).json();
  assert.deepEqual([status.connected, status.endpoint], [false, 'https://synapse.example/api/healthsync']);
  const created = await (await handlers.POST(signedIn('POST', '{}'))).json();
  assert.match(created.token, /^hs_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.hint, created.token.slice(-4));

  const bad = await handlers.POST(phone('hs_' + 'x'.repeat(43), hae));
  assert.equal(bad.status, 401);
  const res = await handlers.POST(phone(created.token, hae));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, days: 2, updated: 2, from: '2026-11-07', to: '2026-11-08' });
  await asOwner();
  const rows = await store.records.readRecords();
  const day = rows.find(r => r.id === 'health-2026-11-08');
  assert.equal(day.data.metrics.steps, 5500);
  assert.equal(day.data.source, 'Health Auto Export');

  // Same push again: nothing written, no session opened.
  const before = adminStore.sessions();
  assert.equal((await (await handlers.POST(phone(created.token, hae))).json()).updated, 0);
  assert.equal(adminStore.sessions(), before);

  // A tag the user added in the app survives the next push.
  await asOwner();
  await store.records.saveRecords([{ collection: 'healthDays', id: day.id, data: { ...day.data, tags: ['alcohol'] }, baseRevision: day.revision }]);
  const changed = structuredClone(hae); changed.data.metrics[0].data[1].qty = 6000;
  assert.equal((await (await handlers.POST(phone(created.token, changed))).json()).updated, 1);
  await asOwner();
  const merged = (await store.records.readRecords()).find(r => r.id === day.id).data;
  assert.deepEqual([merged.metrics.steps, merged.tags], [7500, ['alcohol']]);

  status = await (await handlers.GET(signedIn('GET'))).json();
  assert.equal(status.connected, true);
  assert.equal(status.lastSyncDays, 2);
  assert.equal(status.token, undefined, 'the token is never shown again');

  assert.equal((await handlers.POST(phone(created.token, { nope: true }))).status, 400);
  const replaced = await (await handlers.POST(signedIn('POST', '{}'))).json();
  assert.equal((await handlers.POST(phone(created.token, hae))).status, 401, 'the old token stops working');
  await handlers.DELETE(signedIn('DELETE'));
  assert.equal((await handlers.POST(phone(replaced.token, hae))).status, 401);

  // The database refuses malformed health days.
  await asOwner();
  await assert.rejects(store.records.saveRecords([{ collection: 'healthDays', id: 'health-2026-11-09', data: { id: 'health-2026-11-09', date: '2026-11-10', metrics: {}, updatedAt: 'x' }, baseRevision: 0 }]));
  await assert.rejects(store.records.saveRecords([{ collection: 'healthDays', id: 'health-2026-11-09', data: { id: 'health-2026-11-09', date: '2026-11-09', metrics: { steps: 'many' }, updatedAt: 'x' }, baseRevision: 0 }]));
});

const { AppleHealthExportParser, readAppleHealthExport } = await load('/src/utils/healthExport.ts');
const { default: JSZip } = await import('jszip');

const exportXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT Record (MetadataEntry*)>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="en_US">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" unit="count" startDate="2026-11-08 09:05:00 -0500" endDate="2026-11-08 09:20:00 -0500" value="1000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-11-08 09:00:00 -0500" endDate="2026-11-08 09:30:00 -0500" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" unit="count" startDate="2026-11-08 14:00:00 -0500" endDate="2026-11-08 14:10:00 -0500" value="500"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Watch" unit="Cal" startDate="2026-11-08 09:00:00 -0500" endDate="2026-11-08 09:01:00 -0500" value="7"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="2026-11-08 06:00:00 -0500" endDate="2026-11-08 06:00:00 -0500" value="53"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="2026-11-08 03:00:00 -0500" endDate="2026-11-08 03:01:00 -0500" value="58">
  <HeartRateVariabilityMetadataList>
   <InstantaneousBeatsPerMinute bpm="60" time="3:00:01.00 AM"/>
  </HeartRateVariabilityMetadataList>
 </Record>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="2026-11-08 05:00:00 -0500" endDate="2026-11-08 05:01:00 -0500" value="62"/>
 <Record type="HKQuantityTypeIdentifierRespiratoryRate" sourceName="Watch" unit="count/min" startDate="2026-11-07 23:50:00 -0500" endDate="2026-11-07 23:51:00 -0500" value="15"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2026-11-08 17:20:00 -0500" endDate="2026-11-08 17:20:00 -0500" value="178"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="lb" startDate="2026-11-08 07:00:00 -0500" endDate="2026-11-08 07:00:00 -0500" value="150"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" startDate="2026-11-08 02:00:00 -0500" endDate="2026-11-08 02:00:00 -0500" value="0.96"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Phone" startDate="2026-11-07 23:00:00 -0500" endDate="2026-11-08 07:00:00 -0500" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain&apos;s Watch" startDate="2026-11-07 23:30:00 -0500" endDate="2026-11-08 02:30:00 -0500" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain&apos;s Watch" startDate="2026-11-08 02:30:00 -0500" endDate="2026-11-08 03:30:00 -0500" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain&apos;s Watch" startDate="2026-11-08 03:30:00 -0500" endDate="2026-11-08 03:45:00 -0500" value="HKCategoryValueSleepAnalysisAwake"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain&apos;s Watch" startDate="2026-11-08 03:45:00 -0500" endDate="2026-11-08 06:45:00 -0500" value="HKCategoryValueSleepAnalysisAsleepREM"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Other app" startDate="2026-11-07 22:00:00 -0500" endDate="2026-11-08 08:00:00 -0500" value="HKCategoryValueSleepAnalysisAsleepUnspecified"/>
 <Record type="HKCategoryTypeIdentifierAppleStandHour" sourceName="Watch" startDate="2026-11-08 09:00:00 -0500" endDate="2026-11-08 10:00:00 -0500" value="HKCategoryValueAppleStandHourStood"/>
 <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="App" unit="mL" startDate="2026-11-08 09:00:00 -0500" endDate="2026-11-08 09:00:00 -0500" value="250"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="40" durationUnit="min" sourceName="Watch" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:40:00 -0500">
  <WorkoutActivity uuid="a" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:20:00 -0500" duration="20" durationUnit="min">
   <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:20:00 -0500" average="120" minimum="90" maximum="140" unit="count/min"/>
  </WorkoutActivity>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:40:00 -0500" average="152" minimum="90" maximum="178" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:40:00 -0500" sum="410" unit="Cal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-11-08 17:00:00 -0500" endDate="2026-11-08 17:40:00 -0500" sum="4" unit="mi"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="0.5" durationUnit="hr" totalEnergyBurned="200" totalEnergyBurnedUnit="Cal" sourceName="Watch" startDate="2016-03-01 18:00:00 -0500" endDate="2016-03-01 18:30:00 -0500"/>
 <ActivitySummary dateComponents="2026-11-08" activeEnergyBurned="612" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="Cal" appleExerciseTime="45" appleStandHours="11"/>
 <ActivitySummary dateComponents="2026-11-09" activeEnergyBurned="0" activeEnergyBurnedUnit="Cal" appleExerciseTime="0" appleStandHours="0"/>
</HealthData>
`;

test('Apple Health export: de-duplicates sources, prefers Activity summaries, picks the most detailed night', () => {
  const parser = new AppleHealthExportParser();
  for (let i = 0; i < exportXml.length; i += 97) parser.feed(exportXml.slice(i, i + 97)); // Tags split across chunks.
  const days = parser.finish();
  assert.deepEqual(days.map(d => d.date), ['2016-03-01', '2026-11-08']);
  const d = days[1];
  assert.equal(d.metrics.steps, 1700, 'phone and watch in the same hour count once (the larger), other hours add');
  assert.equal(d.metrics.activeKcal, 612, 'Activity summary wins over summed samples');
  assert.equal(d.metrics.exerciseMin, 45);
  assert.equal(d.metrics.standHours, 11);
  assert.equal(d.metrics.restingHr, 53);
  assert.equal(d.metrics.hrv, 60);
  assert.equal(d.metrics.respRate, 15, 'overnight breathing rate belongs to the morning');
  assert.equal(d.metrics.maxHr, 178);
  assert.equal(d.metrics.weightKg, 68);
  assert.equal(d.metrics.spo2, 96);
  assert.equal(d.metrics.sleepMin, 420, 'the staged watch night (core+deep+REM) beats a longer unstaged one');
  assert.deepEqual([d.metrics.deepMin, d.metrics.remMin, d.metrics.coreMin, d.metrics.awakeMin, d.metrics.inBedMin], [60, 180, 180, 15, 480]);
  assert.deepEqual([d.sleepStart, d.sleepEnd], ['2026-11-07 23:30', '2026-11-08 06:45']);
  assert.deepEqual(d.workouts, [{ id: '2026-11-08 17:00|Running', type: 'Running', start: '2026-11-08 17:00', minutes: 40, avgHr: 152, maxHr: 178, energyKcal: 410, distanceKm: 6.44 }]);
  assert.deepEqual(days[0].workouts[0], { id: '2016-03-01 18:00|Traditional Strength Training', type: 'Traditional Strength Training', start: '2016-03-01 18:00', minutes: 30, energyKcal: 200 });
  assert.ok(!days.some(x => x.date === '2026-11-09'), 'an all-zero summary is not a day of data');
});

test('reads the export straight from the zip, and importing it twice changes nothing', async () => {
  const zip = new JSZip();
  zip.file('apple_health_export/export_cda.xml', '<ClinicalDocument/>');
  zip.file('apple_health_export/workout-routes/route_1.gpx', '<gpx/>');
  zip.file('apple_health_export/export.xml', exportXml);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const progress = [];
  const { patches, records } = await readAppleHealthExport(new File([bytes], 'export.zip'), f => progress.push(f));
  assert.equal(patches.length, 2);
  assert.ok(records >= 20);
  assert.equal(progress.at(-1), 1);
  const plain = await readAppleHealthExport(new File([exportXml], 'export.xml'));
  assert.deepEqual(plain.patches, patches);
  const first = applyHealthPatches([], patches, 'Apple Health export');
  const again = applyHealthPatches(first.days, patches, 'Apple Health export');
  assert.equal(again.changed.length, 0);
  await assert.rejects(readAppleHealthExport(new File([await new JSZip().file('x.txt', 'hi').generateAsync({ type: 'uint8array' })], 'other.zip')), /No export\.xml/);
});
