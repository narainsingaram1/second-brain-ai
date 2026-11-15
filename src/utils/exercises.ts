import RAW from "../data/exercises.json";

/**
 * The exercise library: the public-domain free-exercise-db (github.com/yuhonas/free-exercise-db, Unlicense)
 * plus common moves it lacks. Shared by the app and the assistant's tools, so both find exercises the same way.
 * Instructions are large, so they live in /exercise-instructions.json and are fetched only when shown.
 */

export type Muscle = "abdominals" | "abductors" | "adductors" | "biceps" | "calves" | "chest" | "forearms" | "glutes" | "hamstrings"
  | "lats" | "lower back" | "middle back" | "neck" | "quadriceps" | "shoulders" | "traps" | "triceps";
export interface Exercise {
  id: string;
  name: string;
  category: string;
  equipment: string;
  primary: Muscle[];
  secondary: Muscle[];
  level: string;
  force: string;
  mechanic: string;
  /** How many photos the source dataset has (0 for the added moves). */
  images: number;
  custom?: boolean;
}
/** What a set of this exercise records. */
export type Measure = "weight_reps" | "reps" | "time" | "distance_time";

type Row = [string, string, string, string, string[], string[], string, string, string, number];
export const EXERCISES: Exercise[] = (RAW as Row[]).map(([id, name, category, equipment, primary, secondary, level, force, mechanic, images]) =>
  ({ id, name, category, equipment, primary: primary as Muscle[], secondary: secondary as Muscle[], level, force, mechanic, images }));
const BY_ID = new Map(EXERCISES.map(e => [e.id, e]));

export const MUSCLES: Muscle[] = ["chest", "shoulders", "triceps", "lats", "middle back", "traps", "biceps", "forearms", "lower back",
  "abdominals", "quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors", "neck"];
export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "body only", "kettlebells", "bands", "e-z curl bar", "medicine ball", "exercise ball", "foam roll", "other"];
export const CATEGORIES = ["strength", "powerlifting", "olympic weightlifting", "strongman", "plyometrics", "cardio", "stretching"];

/** Broad groups used for split balance and weekly volume. */
export type MuscleGroup = "push" | "pull" | "legs" | "core";
export const GROUP_OF: Record<Muscle, MuscleGroup> = {
  chest: "push", shoulders: "push", triceps: "push",
  lats: "pull", "middle back": "pull", traps: "pull", biceps: "pull", forearms: "pull", "lower back": "pull", neck: "pull",
  quadriceps: "legs", hamstrings: "legs", glutes: "legs", calves: "legs", adductors: "legs", abductors: "legs",
  abdominals: "core",
};

/** The moves most people mean; they rank first when a search matches several. */
const POPULAR = new Set(["Barbell_Bench_Press_-_Medium_Grip", "Barbell_Squat", "Barbell_Deadlift", "x-overhead-press", "Pullups", "Chin-Up",
  "Bent_Over_Barbell_Row", "Romanian_Deadlift", "Incline_Dumbbell_Press", "Dumbbell_Bench_Press", "x-lat-pulldown", "Seated_Cable_Rows",
  "Leg_Press", "Leg_Extensions", "Lying_Leg_Curls", "Seated_Leg_Curl", "Barbell_Hip_Thrust", "x-dumbbell-lateral-raise", "Face_Pull",
  "Barbell_Curl", "Hammer_Curls", "x-cable-triceps-pushdown", "EZ-Bar_Skullcrusher", "Dips_-_Triceps_Version", "Pushups", "Plank",
  "Dumbbell_Shoulder_Press", "Cable_Crossover", "x-pec-deck-machine", "Standing_Calf_Raises", "x-bulgarian-split-squat", "Dumbbell_Lunges",
  "Goblet_Squat", "Running_Treadmill", "Bicycling_Stationary", "Rowing_Stationary", "x-outdoor-running", "x-walking", "Hanging_Leg_Raise",
  "Cable_Crunch", "Barbell_Shrug", "Hack_Squat", "One-Arm_Dumbbell_Row", "x-kettlebell-swing", "x-burpee", "x-jump-rope", "x-machine-chest-press",
  "Preacher_Curl", "Sumo_Deadlift", "Dumbbell_Flyes", "Reverse_Flyes", "Elliptical_Trainer", "Stairmaster", "Bodyweight_Squat"]);

/** Gym shorthand and everyday names for the moves they mean. */
const ALIAS_NAMES: Record<string, string> = {
  "bench": "Barbell_Bench_Press_-_Medium_Grip", "bench press": "Barbell_Bench_Press_-_Medium_Grip", "barbell bench press": "Barbell_Bench_Press_-_Medium_Grip",
  "flat bench": "Barbell_Bench_Press_-_Medium_Grip", "squat": "Barbell_Squat", "back squat": "Barbell_Squat", "deadlift": "Barbell_Deadlift",
  "ohp": "x-overhead-press", "military press": "Standing_Military_Press", "shoulder press": "Dumbbell_Shoulder_Press", "pull up": "Pullups", "chin up": "Chin-Up",
  "rdl": "Romanian_Deadlift", "barbell row": "Bent_Over_Barbell_Row", "bent over row": "Bent_Over_Barbell_Row",
  "incline db press": "Incline_Dumbbell_Press", "db bench": "Dumbbell_Bench_Press", "dumbbell bench": "Dumbbell_Bench_Press",
  "pulldown": "x-lat-pulldown", "cable row": "Seated_Cable_Rows", "seated row": "Seated_Cable_Rows", "leg curl": "Lying_Leg_Curls",
  "leg extension": "Leg_Extensions", "hip thrust": "Barbell_Hip_Thrust", "lateral raise": "x-dumbbell-lateral-raise", "side raise": "x-dumbbell-lateral-raise",
  "curl": "Barbell_Curl", "bicep curl": "Barbell_Curl", "hammer curl": "Hammer_Curls", "triceps pushdown": "x-cable-triceps-pushdown",
  "tricep pushdown": "x-cable-triceps-pushdown", "pushdown": "x-cable-triceps-pushdown", "skull crusher": "EZ-Bar_Skullcrusher",
  "skullcrusher": "EZ-Bar_Skullcrusher", "dip": "Dips_-_Triceps_Version", "push up": "Pushups", "calf raise": "Standing_Calf_Raises",
  "lunge": "Dumbbell_Lunges", "treadmill": "Running_Treadmill", "run": "x-outdoor-running", "running": "x-outdoor-running", "jog": "x-outdoor-running",
  "bike": "Bicycling_Stationary", "cycling": "x-outdoor-cycling", "rower": "Rowing_Stationary", "walk": "x-walking", "pec deck": "x-pec-deck-machine",
  "chest fly": "Dumbbell_Flyes", "fly": "Dumbbell_Flyes", "shrug": "Barbell_Shrug", "kb swing": "x-kettlebell-swing", "rear delt fly": "Reverse_Flyes",
};

/** Lowercase letters and digits only, with a plural "s" dropped from each word, so "Push-Ups" and "pushup" match. */
export function exerciseKey(text: string): string {
  return text.toLocaleLowerCase().replace(/\bdb\b/g, "dumbbell").replace(/\bbb\b/g, "barbell").replace(/\bkb\b/g, "kettlebell")
    .split(/[^a-z0-9]+/).filter(Boolean).map(w => w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w).join("");
}
const wordsOf = (name: string) => name.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(exerciseKey);
const ALIASES: Record<string, string> = Object.fromEntries(Object.entries(ALIAS_NAMES).map(([name, id]) => [exerciseKey(name), id]));
const KEYED = EXERCISES.map(e => ({ e, key: exerciseKey(e.name), words: wordsOf(e.name) }));
const BY_KEY = new Map(KEYED.map(k => [k.key, k.e]));

export const customExerciseId = (name: string) => `custom-${exerciseKey(name).slice(0, 60) || "exercise"}`;
export const isCustomExercise = (id: string) => id.startsWith("custom-");

/** A library exercise, or a stand-in for a custom one the user named. */
export function exerciseById(id: string, name?: string): Exercise | undefined {
  const found = BY_ID.get(id);
  if (found || !isCustomExercise(id)) return found;
  return { id, name: name || id.slice(7), category: "strength", equipment: "other", primary: [], secondary: [], level: "", force: "", mechanic: "", images: 0, custom: true };
}

/** The library exercise this name means (exact name, or common shorthand like "RDL"), or undefined. */
export function findExercise(name: string): Exercise | undefined {
  const key = exerciseKey(name);
  if (!key) return undefined;
  const alias = ALIASES[key];
  return BY_KEY.get(key) || (alias ? BY_ID.get(alias) : undefined);
}

/** The library ID and display name to store for an exercise the user or assistant named. Unknown names become custom exercises. */
export function resolveExercise(name: string, exerciseId?: string): { exerciseId: string; name: string } {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (exerciseId && BY_ID.has(exerciseId)) return { exerciseId, name: BY_ID.get(exerciseId)!.name };
  if (exerciseId && isCustomExercise(exerciseId) && clean) return { exerciseId, name: clean };
  const found = findExercise(clean);
  if (found) return { exerciseId: found.id, name: found.name };
  if (!clean) throw new Error("Name the exercise.");
  return { exerciseId: customExerciseId(clean), name: clean };
}

export interface ExerciseFilter { muscle?: string; equipment?: string; category?: string }
/** Library exercises matching words in any order ("db incline" finds Incline Dumbbell Press), best first. */
export function searchExercises(query: string, filter: ExerciseFilter = {}, extra: Exercise[] = []): Exercise[] {
  const words = query.toLocaleLowerCase().split(/\s+/).map(exerciseKey).filter(Boolean);
  const whole = exerciseKey(query);
  const alias = ALIASES[whole];
  const pool = [...extra.map(e => ({ e, key: exerciseKey(e.name), words: wordsOf(e.name) })), ...KEYED];
  // Short words must start a word ("rdl" is not inside "hurdle"); longer ones may appear anywhere ("pushup" in "pushups").
  const hit = (w: string, key: string, nameWords: string[]) => w.length <= 3 ? nameWords.some(n => n.startsWith(w)) : key.includes(w);
  const scored: Array<{ e: Exercise; score: number }> = [];
  for (const { e, key, words: nameWords } of pool) {
    if (filter.muscle && !e.primary.includes(filter.muscle as Muscle) && !e.secondary.includes(filter.muscle as Muscle)) continue;
    if (filter.equipment && e.equipment !== filter.equipment) continue;
    if (filter.category && e.category !== filter.category) continue;
    let score = 0;
    if (!words.length) score = 1;
    else if (key === whole || e.id === alias) score = 100;
    else if (key.startsWith(whole)) score = 70;
    else if (words.every(w => hit(w, key, nameWords))) score = 40;
    else continue;
    if (POPULAR.has(e.id)) score += 15;
    if (e.custom) score += 10;
    if (filter.muscle && e.primary.includes(filter.muscle as Muscle)) score += 5;
    score -= Math.min(15, key.length / 4);
    scored.push({ e, score });
  }
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).map(s => s.e).filter(e => !seen.has(e.id) && !!seen.add(e.id));
}

/** What a set records for this exercise: load and reps for most lifts, time for holds and stretches, distance for cardio. */
export function measureOf(e: Exercise | undefined): Measure {
  if (!e) return "weight_reps";
  if (e.category === "cardio") return "distance_time";
  if (e.category === "stretching" || (e.force === "static" && e.equipment === "body only")) return "time";
  if (e.equipment === "body only" || e.category === "plyometrics") return "reps";
  return "weight_reps";
}

const IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
/** A photo of the exercise from the source dataset, when it has one. */
export function exerciseImage(e: Exercise, index = 0): string | undefined {
  return e.images > index ? `${IMAGE_BASE}${encodeURIComponent(e.id)}/${index}.jpg` : undefined;
}

let instructions: Promise<Record<string, string[]>> | undefined;
/** Step-by-step instructions, loaded on first use. */
export function exerciseInstructions(id: string): Promise<string[]> {
  instructions ||= fetch(`${import.meta.env?.BASE_URL || "/"}exercise-instructions.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  return instructions.then(all => all[id] || []);
}

export const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
