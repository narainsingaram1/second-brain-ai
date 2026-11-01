import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => server.close());
const { normalizeTaskAppearance, taskIconKey, renameTaskIcon } =
  await server.ssrLoadModule("/src/utils/taskAppearance.ts");
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
