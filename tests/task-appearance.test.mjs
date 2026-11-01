import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const {
  normalizeTaskAppearance,
  taskIconKey,
  renameTaskIcon,
  subsectionStyle,
} = await server.ssrLoadModule("/src/utils/taskAppearance.ts");
test("appearance handles old workspaces and malformed preferences without unsafe styles", () => {
  assert.deepEqual(normalizeTaskAppearance(undefined), {
    accent: "purple",
    icons: {},
  });
  assert.deepEqual(
    normalizeTaskAppearance({
      accent: "url(evil)",
      icons: { bad: "<svg>", good: "BookOpen" },
    }),
    { accent: "purple", icons: { good: "BookOpen" } },
  );
});
test("subsection icons follow renames without changing sibling or section icons", () => {
  const before = {
    accent: "green",
    icons: {
      [taskIconKey("Work")]: "BriefcaseBusiness",
      [taskIconKey("Work", "Plan")]: "Rocket",
      [taskIconKey("Work", "Other")]: "Heart",
    },
  };
  const next = renameTaskIcon(before, "Work", "Plan", "Launch");
  assert.equal(next.icons[taskIconKey("Work", "Launch")], "Rocket");
  assert.equal(next.icons[taskIconKey("Work", "Plan")], undefined);
  assert.equal(next.icons[taskIconKey("Work")], "BriefcaseBusiness");
  assert.equal(next.icons[taskIconKey("Work", "Other")], "Heart");
  assert.equal(before.icons[taskIconKey("Work", "Plan")], "Rocket");
  assert.notEqual(taskIconKey("a::b", "c"), taskIconKey("a", "b::c"));
});

test("subsections retain independent palettes and artwork across default changes and renames", () => {
  const first = taskIconKey("Academic", "CS 2110"),
    second = taskIconKey("Academic", "LMC 3403");
  const state = {
    accent: "purple",
    icons: {},
    subsections: {
      [first]: { accent: "green", visual: "network" },
      [second]: { accent: "blue", visual: "book" },
    },
  };
  const restored = normalizeTaskAppearance(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(
    subsectionStyle({ ...restored, accent: "orange" }, "Academic", "CS 2110"),
    { accent: "green", visual: "network" },
  );
  assert.deepEqual(subsectionStyle(restored, "Academic", "LMC 3403"), {
    accent: "blue",
    visual: "book",
  });
  const renamed = renameTaskIcon(restored, "Academic", "CS 2110", "Systems");
  assert.deepEqual(subsectionStyle(renamed, "Academic", "Systems"), {
    accent: "green",
    visual: "network",
  });
  assert.equal(renamed.subsections[first], undefined);
  assert.deepEqual(renamed.subsections[second], state.subsections[second]);
  assert.deepEqual(restored, state);
});
test("unknown subsection colors and artwork fall back to supported styles", () => {
  const key = taskIconKey("Work", "Plan");
  const normalized = normalizeTaskAppearance({
    accent: "blue",
    icons: {},
    subsections: {
      [key]: { accent: "url(bad)", visual: "<script>" },
      bad: null,
    },
  });
  assert.deepEqual(normalized.subsections, {
    [key]: { accent: "purple", visual: "none" },
  });
  assert.equal(
    subsectionStyle({ accent: "purple", icons: {} }, "Academic", "CS 3600")
      .visual,
    "network",
  );
});
