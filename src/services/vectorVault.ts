import { Task, JournalEntry, KnowledgeItem, Habit, BrainState } from "../types";
import {
  saveVectorChunksToDB,
  getAllVectorChunksFromDB,
  deleteVectorChunksByItemFromDB,
  clearVectorVaultDB,
} from "./database";

export interface VectorChunk {
  id: string;
  item_id: string;
  item_type: "task" | "journal" | "knowledge" | "habit";
  title: string;
  content: string;
  date?: string;
  metadata: Record<string, any>;
  embedding: number[];
  norm: number;
}

export interface SearchResult {
  chunk: VectorChunk;
  score: number; // 0.0 to 1.0 (cosine similarity)
}

export interface VaultStats {
  total_chunks: number;
  total_items: number;
  vector_dim: number;
  last_indexed: string;
  storage_path: string;
  provider: "openrouter" | "local";
}

// =========================================================================
// 384-DIMENSIONAL DETERMINISTIC SEMANTIC VECTOR PROJECTION ENGINE
// =========================================================================

const SEMANTIC_CLUSTERS: Record<string, string[]> = {
  action: [
    "task", "action", "todo", "do", "execute", "build", "ship", "implement", "create", "make",
    "fix", "resolve", "debug", "finish", "complete", "submit", "deliver", "deploy", "send", "write",
    "call", "schedule", "plan", "start", "prepare", "organize", "update", "refactor", "test", "run"
  ],
  urgency: [
    "urgent", "asap", "priority", "deadline", "today", "tomorrow", "due", "critical", "high",
    "important", "now", "soon", "overdue", "late", "immediate", "tonight", "morning", "evening"
  ],
  academic_tech: [
    "algorithm", "cs", "computer", "code", "programming", "software", "data", "database", "tree",
    "graph", "sorting", "react", "rust", "typescript", "python", "javascript", "api", "backend",
    "frontend", "system", "architecture", "math", "calculus", "linear", "algebra", "exam", "lab",
    "lecture", "assignment", "homework", "quiz", "class", "course", "study", "engineering", "machine", "learning", "ai"
  ],
  health_body: [
    "workout", "gym", "exercise", "lift", "weights", "run", "running", "jog", "cardio", "stretch",
    "health", "fitness", "water", "drink", "diet", "sleep", "rest", "nutrition", "calories", "protein",
    "muscle", "steps", "walk", "recovery", "body", "physical", "energy"
  ],
  emotion_reflection: [
    "feel", "felt", "mood", "happy", "great", "ecstatic", "proud", "grateful", "gratitude", "peace",
    "calm", "tired", "stressed", "anxious", "anxiety", "overwhelmed", "frustrated", "struggled",
    "hard", "easy", "win", "wins", "celebrate", "reflection", "journal", "mind", "mental"
  ],
  mindset_philosophy: [
    "habit", "habits", "routine", "discipline", "focus", "consistency", "streak", "stoic", "philosophy",
    "clarity", "purpose", "growth", "learn", "learning", "wisdom", "patience", "resilience", "vision",
    "principles", "goals", "milestone", "motivation"
  ],
  career_finance: [
    "career", "job", "internship", "interview", "resume", "offer", "company", "client", "work",
    "professional", "finance", "money", "budget", "spend", "save", "savings", "invest", "investment",
    "cost", "expense", "salary", "pay", "contract", "business"
  ],
  learning_reading: [
    "book", "read", "reading", "article", "paper", "notes", "knowledge", "research", "concept",
    "summary", "synthesize", "insight", "chapter", "guide", "author", "resource", "learnings"
  ],
  people_relationships: [
    "team", "friend", "friends", "family", "mentor", "colleague", "meeting", "sync", "discussion",
    "conversation", "talk", "chat", "collaborate", "partnership", "community", "connect"
  ],
  blockers_challenges: [
    "problem", "issue", "blocker", "challenge", "bug", "error", "hurdle", "obstacle", "stuck",
    "difficulty", "failure", "mistake", "delay", "friction"
  ],
  time_dates: [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "week", "month", "year", "daily", "weekly", "yesterday", "recently"
  ],
  outcomes_metrics: [
    "result", "results", "score", "progress", "metric", "percentage", "rate", "improve", "improvement",
    "better", "best", "record", "achievement", "completed", "done", "accomplished", "status"
  ]
};

const DIMENSIONS = 384;
const CLUSTER_KEYS = Object.keys(SEMANTIC_CLUSTERS);
const SLOTS_PER_CLUSTER = Math.floor(DIMENSIONS / CLUSTER_KEYS.length); // 32 dimensions per cluster

/**
 * Computes a fast, 384-dimensional normalized semantic vector embedding.
 */
export function generateLocalSemanticEmbedding(text: string): { embedding: number[]; norm: number } {
  const vector = new Float32Array(DIMENSIONS);
  if (!text || !text.trim()) {
    return { embedding: Array.from(vector), norm: 0 };
  }

  const clean = text.toLowerCase();
  const tokens = clean.match(/[a-z0-9]+/g) || [];

  tokens.forEach((token, tokenIdx) => {
    // 1. Project onto Semantic Clusters (first 12 * 32 = 384 dimensions)
    CLUSTER_KEYS.forEach((clusterKey, clusterIdx) => {
      const words = SEMANTIC_CLUSTERS[clusterKey];
      let matchWeight = 0;

      if (words.includes(token)) {
        matchWeight = 4.0;
      } else {
        // Substring / root match
        for (const w of words) {
          if (w.length >= 4 && (token.startsWith(w) || w.startsWith(token))) {
            matchWeight = 2.5;
            break;
          }
        }
      }

      if (matchWeight > 0) {
        const clusterBase = clusterIdx * SLOTS_PER_CLUSTER;
        const posFactor = 1.0 / Math.sqrt(tokenIdx + 1);
        const effectiveWeight = matchWeight * (1.0 + posFactor * 0.4);

        // A. Activate Cluster Centroid dimensions (first 8 dimensions of cluster)
        for (let k = 0; k < 8; k++) {
          vector[clusterBase + k] += effectiveWeight * (1.0 - k * 0.08);
        }

        // B. Token-specific hash in remaining 24 dimensions
        let h = 0;
        for (let i = 0; i < token.length; i++) {
          h = (h << 5) - h + token.charCodeAt(i);
          h |= 0;
        }
        const slot = 8 + (Math.abs(h) % 24);
        vector[clusterBase + slot] += effectiveWeight * 1.5;
      }
    });

    // 2. Global N-gram subword hashing for out-of-vocabulary terms (subtle weight)
    for (let i = 0; i < token.length - 2; i++) {
      const trigram = token.substring(i, i + 3);
      let th = 5381;
      for (let j = 0; j < trigram.length; j++) {
        th = (th * 33) ^ trigram.charCodeAt(j);
      }
      const dim = Math.abs(th) % DIMENSIONS;
      vector[dim] += 0.08;
    }
  });

  // Calculate L2 norm
  let sumSq = 0;
  for (let i = 0; i < DIMENSIONS; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq);

  // Normalize to unit vector
  if (norm > 0) {
    for (let i = 0; i < DIMENSIONS; i++) {
      vector[i] /= norm;
    }
  }

  return {
    embedding: Array.from(vector),
    norm: norm > 0 ? 1.0 : 0.0,
  };
}

/**
 * Fetches neural vector embedding from OpenRouter (openai/text-embedding-3-small).
 * Falls back to the local deterministic semantic engine if offline or no key.
 */
export async function getEmbedding(
  text: string,
  openRouterKey?: string
): Promise<{ embedding: number[]; norm: number; provider: "openrouter" | "local" }> {
  if (openRouterKey && openRouterKey.trim() !== "") {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://synapse-second-brain.local",
          "X-Title": "Synapse Second Brain",
        },
        body: JSON.stringify({
          model: "openai/text-embedding-3-small",
          input: text.slice(0, 8000),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const emb = data?.data?.[0]?.embedding;
        if (Array.isArray(emb) && emb.length > 0) {
          let sumSq = 0;
          for (const v of emb) sumSq += v * v;
          const norm = Math.sqrt(sumSq);
          return {
            embedding: emb,
            norm: norm > 0 ? norm : 1.0,
            provider: "openrouter",
          };
        }
      }
    } catch {
      // Fallback seamlessly to local engine
    }
  }

  const local = generateLocalSemanticEmbedding(text);
  return {
    ...local,
    provider: "local",
  };
}

// =========================================================================
// CHUNKING STRATEGY FOR ALL BRAIN ENTITIES
// =========================================================================

export function chunkTask(task: Task): { title: string; content: string; date?: string; metadata: any } {
  const statusStr = task.status || (task.completed ? "completed" : "not_started");
  const subtasksStr = (task.subtasks || [])
    .map((s) => `[${s.completed ? "x" : " "}] ${s.title}`)
    .join("; ");
  const tagsStr = (task.tags || []).join(", ");

  const content = [
    `Task: "${task.title}"`,
    `Status: ${statusStr}`,
    `Priority: ${task.priority}`,
    `Section: ${task.section}${task.subsection ? ` / ${task.subsection}` : ""}`,
    task.dueDate ? `Due Date: ${task.dueDate}` : "",
    tagsStr ? `Tags: ${tagsStr}` : "",
    task.description ? `Description: ${task.description}` : "",
    subtasksStr ? `Subtasks: ${subtasksStr}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    title: task.title,
    content,
    date: task.dueDate,
    metadata: {
      section: task.section,
      subsection: task.subsection,
      priority: task.priority,
      status: statusStr,
      completed: task.completed,
    },
  };
}

export function chunkJournal(entry: JournalEntry): { title: string; content: string; date?: string; metadata: any } {
  const winsStr = (entry.wins || []).filter(Boolean).join(", ");
  const challengesStr = (entry.challenges || []).filter(Boolean).join(", ");
  const tagsStr = (entry.tags || []).join(", ");

  const content = [
    `Journal Entry: "${entry.title}" (${entry.date})`,
    `Mood: ${entry.mood}`,
    winsStr ? `Wins & Accomplishments: ${winsStr}` : "",
    challengesStr ? `Challenges & Blockers: ${challengesStr}` : "",
    `Reflection: ${entry.content}`,
    tagsStr ? `Tags: ${tagsStr}` : "",
    entry.aiReflection ? `AI Synthesis & Coaching: ${entry.aiReflection}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    title: entry.title,
    content,
    date: entry.date,
    metadata: {
      mood: entry.mood,
      date: entry.date,
      tags: entry.tags,
    },
  };
}

export function chunkKnowledge(item: KnowledgeItem): { title: string; content: string; date?: string; metadata: any } {
  const content = [
    `Knowledge Note: "${item.subject}"`,
    `Domain: ${item.domain || "General"}`,
    `Status: ${item.status}`,
    item.startDate ? `Timeline: ${item.startDate} to ${item.endDate || "Present"}` : "",
    `Summary: ${item.summary}`,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    title: item.subject,
    content,
    date: item.startDate,
    metadata: {
      status: item.status,
      domain: item.domain,
    },
  };
}

export function chunkHabit(habit: Habit): { title: string; content: string; date?: string; metadata: any } {
  const content = [
    `Habit: "${habit.name}"`,
    `Domain: ${habit.domain || "General"}`,
    `Frequency: ${habit.frequency}`,
    `Current Streak: ${habit.streak} days (All-Time Best: ${habit.bestStreak} days)`,
    habit.timeOfDay ? `Time of Day: ${habit.timeOfDay}` : "",
    habit.description ? `Description: ${habit.description}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    title: habit.name,
    content,
    metadata: {
      frequency: habit.frequency,
      streak: habit.streak,
      bestStreak: habit.bestStreak,
      domain: habit.domain,
    },
  };
}

// =========================================================================
// VECTOR VAULT CLIENT & SYNC SERVICE
// =========================================================================

class SemanticMemoryVaultService {
  private memoryCache: VectorChunk[] = [];
  private isLoaded: boolean = false;

  /**
   * Initializes vault chunks from Tauri Rust file or IndexedDB.
   */
  async init(): Promise<void> {
    if (this.isLoaded) return;

    try {
      // 1. Try Tauri native
      const { invoke } = await import("@tauri-apps/api/core");
      const stats = await invoke<any>("get_vector_vault_stats");
      if (stats) {
        // Tauri backend is active
        this.isLoaded = true;
        return;
      }
    } catch {}

    // 2. Load from IndexedDB
    try {
      this.memoryCache = await getAllVectorChunksFromDB();
      this.isLoaded = true;
    } catch {
      this.memoryCache = [];
      this.isLoaded = true;
    }
  }

  /**
   * Indexes a single brain item into the vector vault.
   */
  async indexItem(
    item: Task | JournalEntry | KnowledgeItem | Habit,
    type: "task" | "journal" | "knowledge" | "habit",
    openRouterKey?: string
  ): Promise<VectorChunk> {
    await this.init();

    let chunkData: { title: string; content: string; date?: string; metadata: any };
    if (type === "task") chunkData = chunkTask(item as Task);
    else if (type === "journal") chunkData = chunkJournal(item as JournalEntry);
    else if (type === "knowledge") chunkData = chunkKnowledge(item as KnowledgeItem);
    else chunkData = chunkHabit(item as Habit);

    const { embedding, norm } = await getEmbedding(chunkData.content, openRouterKey);

    const chunk: VectorChunk = {
      id: `vec-${type}-${item.id}`,
      item_id: item.id,
      item_type: type,
      title: chunkData.title,
      content: chunkData.content,
      date: chunkData.date,
      metadata: chunkData.metadata,
      embedding,
      norm,
    };

    // Save to Tauri native backend
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_vector_chunks", { chunks: [chunk] });
    } catch {}

    // Save to IndexedDB
    await saveVectorChunksToDB([chunk]);

    // Update local cache
    const existingIdx = this.memoryCache.findIndex((c) => c.id === chunk.id);
    if (existingIdx >= 0) {
      this.memoryCache[existingIdx] = chunk;
    } else {
      this.memoryCache.push(chunk);
    }

    return chunk;
  }

  /**
   * Removes chunks belonging to an item (e.g. when deleted).
   */
  async removeItem(itemId: string): Promise<number> {
    await this.init();

    let deleted = 0;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      deleted = await invoke<number>("delete_vector_chunks_by_item", { itemId });
    } catch {}

    const idbDeleted = await deleteVectorChunksByItemFromDB(itemId);
    this.memoryCache = this.memoryCache.filter((c) => c.item_id !== itemId);

    return Math.max(deleted, idbDeleted);
  }

  /**
   * Performs Semantic Vector Search across the Memory Vault.
   * Calculates cosine similarity: (u · v) / (||u|| * ||v||)
   */
  async search(
    query: string,
    topK: number = 5,
    filterType?: string,
    openRouterKey?: string
  ): Promise<SearchResult[]> {
    if (!query || !query.trim()) return [];
    await this.init();

    const { embedding: queryEmbedding } = await getEmbedding(query, openRouterKey);

    // 1. Try Tauri Native Fast Vector Search in Rust
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const results = await invoke<SearchResult[]>("search_vector_chunks", {
        queryEmbedding,
        topK,
        itemType: filterType && filterType !== "all" ? filterType : null,
      });
      if (Array.isArray(results) && results.length > 0) {
        return results;
      }
    } catch {}

    // 2. Fallback in-memory / IndexedDB Cosine Similarity
    if (this.memoryCache.length === 0) {
      this.memoryCache = await getAllVectorChunksFromDB();
    }

    let qNorm = 0;
    for (const v of queryEmbedding) qNorm += v * v;
    qNorm = Math.sqrt(qNorm);
    if (qNorm <= 0) return [];

    const scored: SearchResult[] = [];

    for (const chunk of this.memoryCache) {
      if (filterType && filterType !== "all" && chunk.item_type !== filterType) {
        continue;
      }
      if (chunk.embedding.length !== queryEmbedding.length) {
        continue;
      }

      let dot = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        dot += queryEmbedding[i] * chunk.embedding[i];
      }

      const score = chunk.norm > 0 ? Math.max(0, Math.min(1, dot / (qNorm * chunk.norm))) : 0;
      scored.push({ chunk, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Re-indexes the entire brain state (tasks, habits, journal entries, knowledge items).
   */
  async reindexBrain(
    brainState: BrainState,
    openRouterKey?: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ totalIndexed: number; totalChunks: number }> {
    await this.init();

    const allItems: { item: any; type: "task" | "journal" | "knowledge" | "habit" }[] = [
      ...brainState.tasks.map((t) => ({ item: t, type: "task" as const })),
      ...brainState.journalEntries.map((j) => ({ item: j, type: "journal" as const })),
      ...brainState.knowledgeItems.map((k) => ({ item: k, type: "knowledge" as const })),
      ...brainState.habits.map((h) => ({ item: h, type: "habit" as const })),
    ];

    const chunks: VectorChunk[] = [];
    const total = allItems.length;

    for (let i = 0; i < allItems.length; i++) {
      const { item, type } = allItems[i];
      let chunkData: { title: string; content: string; date?: string; metadata: any };
      if (type === "task") chunkData = chunkTask(item);
      else if (type === "journal") chunkData = chunkJournal(item);
      else if (type === "knowledge") chunkData = chunkKnowledge(item);
      else chunkData = chunkHabit(item);

      const { embedding, norm } = await getEmbedding(chunkData.content, openRouterKey);

      chunks.push({
        id: `vec-${type}-${item.id}`,
        item_id: item.id,
        item_type: type,
        title: chunkData.title,
        content: chunkData.content,
        date: chunkData.date,
        metadata: chunkData.metadata,
        embedding,
        norm,
      });

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    // Save batch to Tauri native backend
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_vector_vault");
      await invoke("save_vector_chunks", { chunks });
    } catch {}

    // Save to IndexedDB
    await clearVectorVaultDB();
    await saveVectorChunksToDB(chunks);
    this.memoryCache = chunks;

    return { totalIndexed: total, totalChunks: chunks.length };
  }

  /**
   * Retrieves statistics about the Semantic Memory Vault.
   */
  async getVaultStats(): Promise<VaultStats> {
    await this.init();

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const stats = await invoke<any>("get_vector_vault_stats");
      if (stats) {
        return {
          total_chunks: stats.total_chunks,
          total_items: stats.total_items,
          vector_dim: stats.vector_dim || DIMENSIONS,
          last_indexed: stats.last_indexed || "Active",
          storage_path: stats.storage_path || "~/.second_brain_ai/vector_vault.json",
          provider: stats.vector_dim === 1536 ? "openrouter" : "local",
        };
      }
    } catch {}

    const chunks = this.memoryCache.length > 0 ? this.memoryCache : await getAllVectorChunksFromDB();
    const itemIds = new Set(chunks.map((c) => c.item_id));
    const dim = chunks[0]?.embedding?.length || DIMENSIONS;

    return {
      total_chunks: chunks.length,
      total_items: itemIds.size,
      vector_dim: dim,
      last_indexed: new Date().toLocaleDateString(),
      storage_path: "IndexedDB (Browser / Synapse Second Brain)",
      provider: dim === 1536 ? "openrouter" : "local",
    };
  }
}

export const vectorVault = new SemanticMemoryVaultService();
