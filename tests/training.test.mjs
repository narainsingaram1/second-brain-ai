// Training in the Health workspace: the exercise library, the numbers worked out from sessions, the assistant's
// workout and plan tools, and the database rules for the workouts and workoutPlans collections.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { owner, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';

const server = await createServer({ cacheDir: '/tmp/synapse-training-test-cache', configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { EXERCISES, searchExercises, resolveExercise, findExercise, measureOf, exerciseById } = await load('/src/utils/exercises.ts');
const T = await load('/src/utils/training.ts');
const { prepareMutation, applyMutation, mutationRecords, executeRead } = await load('/src/services/brainTools.ts');

const LB = 0.45359237;
const set = (lb, reps, extra = {}) => ({ weightKg: lb * LB, reps, done: true, ...extra });
const session = (date, exercises, extra = {}) => ({ id: `w-${date}-${Math.random()}`, date, name: 'Push', exercises: exercises.map(([exerciseId, name, sets]) => ({ id: name, exerciseId, name, sets })), createdAt: `${date}T18:00:00Z`, updatedAt: `${date}T19:00:00Z`, ...extra });
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';

test('the library has gym, home and cardio moves and finds them by shorthand', () => {
  assert.ok(EXERCISES.length > 900, `${EXERCISES.length} exercises`);
  assert.equal(new Set(EXERCISES.map(e => e.id)).size, EXERCISES.length, 'IDs are unique');
  assert.equal(searchExercises('rdl')[0].name, 'Romanian Deadlift');
  assert.ok(!searchExercises('rdl').some(e => /hurdle/i.test(e.name)), 'short words must start a word');
  assert.equal(searchExercises('bench')[0].id, BENCH);
  assert.equal(searchExercises('incline db press')[0].name, 'Incline Dumbbell Press');
  assert.equal(findExercise('push-ups').id, 'Pushups');
  assert.equal(findExercise('OHP').name, 'Overhead Press');
  assert.ok(searchExercises('', { equipment: 'body only' }).length > 100, 'plenty of bodyweight moves for home');
  assert.ok(searchExercises('', { muscle: 'hamstrings' }).every(e => e.primary.includes('hamstrings') || e.secondary.includes('hamstrings')));
  assert.deepEqual(resolveExercise('Sled sprints into the sea'), { exerciseId: 'custom-sledsprintintothesea', name: 'Sled sprints into the sea' });
  assert.equal(exerciseById('custom-sledsprintintothesea', 'Sled sprints').custom, true);
  assert.equal(measureOf(findExercise('treadmill')), 'distance_time');
  assert.equal(measureOf(findExercise('plank')), 'time');
  assert.equal(measureOf(findExercise('pullup')), 'reps');
  assert.equal(measureOf(findExercise('bench')), 'weight_reps');
});

test('estimated max, records, trends and plateaus come from the sessions', () => {
  assert.equal(T.e1rm(100, 1), 100);
  assert.equal(Math.round(T.e1rm(100, 10)), 133);
  assert.equal(T.e1rm(100, 20), undefined, 'high-rep sets give no estimate');
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
  const workouts = weeks.map((d, i) => session(d, [
    [BENCH, 'Bench', [set(135, 5, { kind: 'warmup' }), set(185 + i * 5, 8), set(185 + i * 5, 8)]],
    ['x-overhead-press', 'Overhead Press', [set(i < 3 ? 95 + i * 5 : 105, 6), set(i < 3 ? 95 + i * 5 : 105, 6)]],
  ]));
  const bench = T.exerciseHistory(workouts, BENCH);
  assert.equal(bench.length, 8);
  assert.equal(bench[0].sets, 2, 'warm-ups are not working sets');
  assert.equal(Math.round(bench[7].topWeightKg / LB), 220);
  const trends = T.exerciseTrends(workouts, '2026-11-02');
  assert.equal(trends.find(t => t.exerciseId === BENCH).status, 'progressing');
  const ohp = trends.find(t => t.exerciseId === 'x-overhead-press');
  assert.equal(ohp.status, 'plateau', 'matching the best again is not progress');
  assert.ok(ohp.weeksSinceBest >= 5);
  const prs = T.personalRecords(workouts);
  assert.ok(prs.some(r => r.exerciseId === BENCH && r.kind === 'e1rm' && r.date === '2026-10-26'));
  assert.ok(!prs.some(r => r.exerciseId === 'x-overhead-press' && r.date > '2026-09-21' && r.kind !== 'volume'));
  const stats = T.trainingStats(workouts, [], [], '2026-11-02', 'lb');
  assert.ok(stats.insights.some(i => i.id === 'flat-x-overhead-press'));
  assert.ok(stats.insights.some(i => i.id === `up-${BENCH}`));
  assert.ok(stats.muscles.find(m => m.muscle === 'chest').sets > 0);
});

test('double progression suggests the next weight', () => {
  const hit = [session('2026-11-02', [[BENCH, 'Bench', [set(185, 12), set(185, 12), set(185, 12)]]])];
  const up = T.suggestNext(hit, BENCH, '8-12', 'lb');
  assert.equal(Math.round(up.weightKg / LB), 190, 'every set at the top of the range adds 5 lb');
  assert.equal(up.reps, 8);
  const mid = T.suggestNext([session('2026-11-02', [[BENCH, 'Bench', [set(185, 9), set(185, 8)]]])], BENCH, '8-12', 'lb');
  assert.equal(Math.round(mid.weightKg / LB), 185);
  assert.equal(mid.reps, 10);
  const missed = [session('2026-10-30', [[BENCH, 'Bench', [set(200, 5)]]]), session('2026-11-02', [[BENCH, 'Bench', [set(200, 6)]]])];
  assert.equal(Math.round(T.suggestNext(missed, BENCH, '8-12', 'lb').weightKg / LB), 180, 'two misses drop about 10%');
  assert.equal(T.suggestNext(hit, BENCH, '8-12', 'kg').weightKg, 87.5, '83.9 kg + 2.5 rounds to the nearest 2.5');
});

test('plans: weekday schedules, rotations and templates', () => {
  for (const t of T.PLAN_TEMPLATES) {
    const p = t.build();
    assert.ok(p.days.length && p.days.every(d => d.exercises.every(e => exerciseById(e.exerciseId))), `${t.key} uses library exercises`);
  }
  const ppl = { id: 'p', name: 'PPL', active: true, createdAt: '', updatedAt: '', ...T.PLAN_TEMPLATES[0].build() };
  assert.equal(T.planTarget(ppl), 6);
  assert.equal(T.planDayFor(ppl, [], '2026-11-16').day.name, 'Push', 'Monday is push');
  assert.equal(T.planDayFor(ppl, [], '2026-11-15'), undefined, 'Sunday is a rest day');
  const fiveByFive = { id: 'f', name: '5x5', active: true, createdAt: '', updatedAt: '', ...T.PLAN_TEMPLATES.find(t => t.key === 'strength-5x5').build() };
  const a = fiveByFive.days[0];
  assert.equal(T.planDayFor(fiveByFive, [], '2026-11-16').day.id, a.id);
  const after = [session('2026-11-14', [], { planId: 'f', planDayId: a.id })];
  assert.equal(T.planDayFor(fiveByFive, after, '2026-11-16').day.name, 'Workout B', 'rotations follow the last day done');
  assert.deepEqual(T.repRange('8-12'), [8, 12]);
  assert.deepEqual(T.repRange('5'), [5, 5]);
  assert.equal(T.repRange('30s'), undefined);
});

test('body weight trend and goal projection', () => {
  const days = Array.from({ length: 29 }, (_, i) => ({ id: `h${i}`, date: T.addDays('2026-10-18', i), metrics: { weightKg: 90 - i * 0.1 }, updatedAt: '' }));
  const wt = T.weightTrend(days, '2026-11-15', 85);
  assert.equal(wt.perWeekKg, -0.7);
  assert.ok(wt.goalDate > '2026-11-15');
  assert.equal(T.fmtWeight(102.0582, 'lb'), '225 lb');
});

const emptyState = () => ({ userId: 'u', tasks: [], goals: [], habits: [], journalEntries: [], knowledgeItems: [], trackerItems: [], events: [], noteFolders: [],
  workspaces: [{ id: 'h', name: 'Health', description: '', template: 'health', color: 'rose', notes: '', createdAt: '2026-01-01', health: { weightUnit: 'lb' } }],
  sections: ['Inbox'], subsections: { Inbox: ['General'] }, chatHistory: [], openRouterKey: '', selectedModel: '', theme: 'light', study: { courses: [], folders: [], documents: [], decks: [], quizzes: [] } });
const run = (state, tool, args) => {
  const m = prepareMutation(tool, args, state);
  if (m.expected) assert.deepEqual(mutationRecords(state, m.type).find(r => r.id === m.record.id), m.expected);
  return applyMutation(state, m);
};

test('the assistant logs, edits and deletes workouts in the user\'s unit', () => {
  let s = run(emptyState(), 'log_workout', { date: '2026-11-14', name: 'Push', exercises: [
    { name: 'bench press', sets: [{ weight: 135, reps: 10, kind: 'warmup' }, { weight: 185, reps: 8, repeat: 3 }] },
    { name: 'Plank', sets: [{ seconds: 60, repeat: 2 }] },
    { name: 'Landmine thing', sets: [{ weight: 45, reps: 12 }] },
  ] });
  const w = s.workouts[0];
  assert.equal(w.exercises[0].exerciseId, BENCH);
  assert.equal(w.exercises[0].sets.length, 4);
  assert.equal(w.exercises[0].sets[0].kind, 'warmup');
  assert.equal(Math.round(w.exercises[0].sets[1].weightKg / LB), 185, 'weights are stored in kg from the user\'s pounds');
  assert.equal(w.exercises[2].exerciseId, 'custom-landminething');
  assert.throws(() => prepareMutation('log_workout', { exercises: [{ name: 'Bench', sets: [{ weight: 100 }] }] }, s), /reps, seconds or distanceKm/);
  s = run(s, 'update_workout', { workoutId: w.id, removeExercises: ['Plank'], replaceExercises: [{ name: 'Barbell Bench Press - Medium Grip', sets: [{ weight: 100, reps: 5, repeat: 5 }] }], unit: 'kg', durationMin: 60 });
  assert.equal(s.workouts[0].exercises.length, 2);
  assert.equal(s.workouts[0].exercises[0].sets[0].weightKg, 100);
  assert.equal(s.workouts[0].durationMin, 60);
  assert.equal(run(s, 'delete_workout', { workoutId: w.id }).workouts.length, 0);
});

test('the assistant builds plans; a new active plan replaces the old one', async () => {
  let s = run(emptyState(), 'create_workout_plan', { name: 'PPL', days: [
    { name: 'Push', weekdays: [1, 4], exercises: [{ name: 'ohp', sets: 3, reps: '6-10' }] },
    { name: 'Pull', weekdays: [2, 5], exercises: [{ name: 'pull up', sets: 3, reps: '8' }] },
  ] });
  const ppl = s.workoutPlans[0];
  assert.equal(ppl.active, true);
  assert.equal(ppl.days[0].exercises[0].name, 'Overhead Press');
  s = run(s, 'create_workout_plan', { name: 'Upper Lower', days: [{ name: 'Upper', exercises: [{ name: 'bench', sets: 4, reps: '5' }] }] });
  assert.deepEqual(s.workoutPlans.map(p => [p.name, p.active]), [['PPL', false], ['Upper Lower', true]]);
  s = run(s, 'update_workout_plan', { planId: ppl.id, active: true, updateDays: [{ day: 'push', newName: 'Push A', weekdays: [] }], addDays: [{ name: 'Legs', exercises: [{ name: 'squat', sets: 4, reps: '5-8' }] }] });
  assert.deepEqual(s.workoutPlans.map(p => p.active), [true, false]);
  assert.equal(s.workoutPlans[0].days[0].name, 'Push A');
  assert.equal(s.workoutPlans[0].days[0].weekdays, undefined);
  assert.equal(s.workoutPlans[0].days[2].exercises[0].exerciseId, 'Barbell_Squat');
  s = run(s, 'log_workout', { planDayId: s.workoutPlans[0].days[2].id, exercises: [{ name: 'squat', sets: [{ weight: 225, reps: 5 }] }] });
  assert.equal(s.workouts[0].name, 'Legs');
  const summary = (await executeRead('training_summary', {}, s, '')).output;
  assert.equal(summary.unit, 'lb');
  assert.equal(summary.activePlan.name, 'PPL');
  const found = (await executeRead('search_exercises', { query: 'curl', muscle: 'biceps' }, s, '')).output;
  assert.ok(found.total > 10 && found.exercises.every(e => e.primary.includes('biceps') || e.secondary.includes('biceps')));
  assert.equal(run(s, 'delete_workout_plan', { planId: ppl.id }).workoutPlans.length, 1);
});

test('database: workouts and plans are record collections with their own rules', async () => {
  const { db, asUser } = await supabaseLikeDatabase();
  try {
    await asUser(owner);
    const valid = async (collection, data) => (await db.query('select public.valid_record($1, $2, $3::jsonb) as ok', [collection, data.id, JSON.stringify(data)])).rows[0].ok;
    const w = { id: 'w1', date: '2026-11-14', name: 'Push', exercises: [{ id: 'e', exerciseId: BENCH, name: 'Bench', sets: [{ weightKg: 84, reps: 8 }] }], createdAt: 'x', updatedAt: 'x' };
    assert.equal(await valid('workouts', w), true);
    assert.equal(await valid('workouts', { ...w, name: ' ' }), false);
    assert.equal(await valid('workouts', { ...w, date: 'today' }), false);
    assert.equal(await valid('workouts', { ...w, exercises: [{ name: 'Bench', sets: [] }] }), false, 'each exercise needs its ID');
    const p = { id: 'p1', name: 'PPL', active: true, days: [{ id: 'd', name: 'Push', exercises: [] }], createdAt: 'x', updatedAt: 'x' };
    assert.equal(await valid('workoutPlans', p), true);
    assert.equal(await valid('workoutPlans', { ...p, active: 'yes' }), false);
    assert.equal(await valid('workoutPlans', { ...p, days: Array.from({ length: 15 }, () => p.days[0]) }), false);
  } finally { await db.close(); }
});
