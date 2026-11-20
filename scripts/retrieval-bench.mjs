// Times keyword search, record queries and memory normalization on a synthetic large workspace.
// Run: node scripts/retrieval-bench.mjs
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
const retrieval = await server.ssrLoadModule("/src/services/brainRetrieval.ts");
const memory = await server.ssrLoadModule("/src/services/agentMemory.ts");
const words = "deadline project budget lecture algorithm review interview workout sleep invoice draft research paper meeting design system cache latency".split(" ");
const sentence = i => Array.from({ length: 40 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ");
const tasks = Array.from({ length: 1500 }, (_, i) => ({ id: `t${i}`, title: `Task ${i} ${words[i % words.length]}`, description: sentence(i), status: "not_started", completed: false, section: "Work", priority: "medium", dueDate: "2026-12-01" }));
const notes = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, subject: "General", content: Array.from({ length: 12 }, (_, p) => `## Part ${p}\n\n${sentence(i + p)} ${sentence(i * p)}`).join("\n\n"), type: "note" }));
const entries = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, topic: `topic ${i}`, category: "preference", content: `User prefers ${sentence(i).slice(0, 200)}`, pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sources: [] }));
// Notes with pasted screenshots carry their image data inline (base64), as the editor stores them.
const image = `![shot](data:image/png;base64,${"A".repeat(400_000)})`;
const imageNotes = Array.from({ length: 20 }, (_, i) => ({ id: `img${i}`, title: `Screenshot note ${i}`, subject: "General", content: `${sentence(i)}\n\n${image}\n\n${sentence(i + 1)}`, type: "note" }));
const state = { userId: "bench", tasks, goals: [], habits: [], journalEntries: [], knowledgeItems: [...notes, ...imageNotes], chatHistory: [], conversations: [], sections: [], subsections: {},
  agentMemory: { version: 1, enabled: true, automaticLearning: true, entries, suppressed: [] } };

const time = async (label, runs, fn) => {
  await fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  console.log(`${label.padEnd(44)} ${((performance.now() - start) / runs).toFixed(2)} ms`);
};
const noKey = { embeddingCache: { get: async () => undefined, put: async () => {} } };
await time("rankPassages (keyword, warm)", 20, () => retrieval.rankPassages(state, "budget latency review", undefined, "", undefined, undefined, noKey));
await time("records(state, 'task') + find one", 20, () => retrieval.records(state, "task").find(r => r.id === "t900")?.text);
await time("records(state, 'knowledge') + find one", 20, () => retrieval.records(state, "knowledge").find(r => r.id === "n10")?.text);
await time("normalizeAgentMemory (same object)", 200, () => memory.normalizeAgentMemory(state.agentMemory));
await server.close();
