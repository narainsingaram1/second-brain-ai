import type { TaskAppearance } from "../types";

export const TASK_ACCENTS = [
  {
    id: "purple",
    label: "Purple",
    light: "#6240c5",
    dark: "#bca6ff",
    rgb: "124, 92, 224",
  },
  {
    id: "blue",
    label: "Blue",
    light: "#245bbd",
    dark: "#94bbff",
    rgb: "59, 115, 220",
  },
  {
    id: "green",
    label: "Green",
    light: "#247044",
    dark: "#8cdbad",
    rgb: "47, 151, 91",
  },
  {
    id: "teal",
    label: "Teal",
    light: "#167477",
    dark: "#7dd6d0",
    rgb: "32, 155, 151",
  },
  {
    id: "rose",
    label: "Rose",
    light: "#b33667",
    dark: "#f5a2c1",
    rgb: "210, 80, 130",
  },
  {
    id: "orange",
    label: "Orange",
    light: "#a45419",
    dark: "#f2b481",
    rgb: "207, 126, 56",
  },
  {
    id: "indigo",
    label: "Indigo",
    light: "#4949b8",
    dark: "#aaaaff",
    rgb: "100, 100, 211",
  },
  {
    id: "slate",
    label: "Slate",
    light: "#506078",
    dark: "#b3c3da",
    rgb: "113, 133, 158",
  },
] as const;

export const taskIconKey = (section: string, subsection?: string) =>
  JSON.stringify([section, subsection ?? null]);
export function normalizeTaskAppearance(value: unknown): TaskAppearance {
  const source =
    value && typeof value === "object"
      ? (value as Partial<TaskAppearance>)
      : {};
  const icons: Record<string, string> = {};
  if (source.icons && typeof source.icons === "object") {
    for (const [key, icon] of Object.entries(source.icons).slice(0, 1000)) {
      if (typeof icon === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(icon))
        icons[key] = icon;
    }
  }
  return {
    accent: TASK_ACCENTS.some((a) => a.id === source.accent)
      ? source.accent!
      : "purple",
    icons,
  };
}
export function renameTaskIcon(
  appearance: TaskAppearance | undefined,
  section: string,
  oldName: string,
  newName: string,
): TaskAppearance {
  const next = normalizeTaskAppearance(appearance);
  const oldKey = taskIconKey(section, oldName);
  const icon = next.icons[oldKey];
  delete next.icons[oldKey];
  if (icon) next.icons[taskIconKey(section, newName)] = icon;
  return next;
}
export function defaultTaskIcon(name: string): string {
  if (/academic|school|university|study/i.test(name)) return "GraduationCap";
  if (/computer|coding|software|^cs\b/i.test(name)) return "Cpu";
  if (/book|lmc|literature|read|journal/i.test(name)) return "BookOpen";
  if (/career|work|business/i.test(name)) return "BriefcaseBusiness";
  if (/health|fitness|gym|workout/i.test(name)) return "HeartPulse";
  if (/personal|home/i.test(name)) return "House";
  if (/project|build/i.test(name)) return "Rocket";
  return "Folder";
}
