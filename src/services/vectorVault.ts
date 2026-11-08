import { BrainState } from "../types";
import { indexStats, rankPassages, RecordType, warmIndex } from "./brainRetrieval";
import { clearVectorVaultDB } from "./database";

/**
 * Search UI adapter over the single hybrid index in brainRetrieval, which the assistant uses too.
 * There is nothing to index on save: passages derive from the live records, and unchanged text
 * reuses its cached embedding (keyed by account, model and content hash).
 */
export interface VaultChunk {
  id: string;
  item_id: string;
  item_type: RecordType;
  title: string;
  content: string;
  date?: string;
}

export interface SearchResult {
  chunk: VaultChunk;
  /** Cosine similarity (0–1) when neural search ran, otherwise a relative keyword score. */
  score: number;
}

export interface VaultStats {
  total_chunks: number;
  total_items: number;
  embedded_chunks: number;
  vector_dim: number;
  storage_path: string;
  provider: "openrouter" | "keyword";
}

export const vectorVault = {
  /** Best passage per record, ranked by the same fusion of keyword and neural search as the assistant. */
  async search(state: BrainState, query: string, topK = 5, filterType?: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const type = filterType && filterType !== "all" ? filterType as RecordType : undefined;
    const { ranked } = await rankPassages(state, query, type, state.openRouterKey, signal);
    const top = ranked[0]?.score || 1;
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const passage of ranked) {
      const key = `${passage.type}:${passage.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        chunk: { id: `${key}:${passage.offset || 0}`, item_id: passage.id, item_type: passage.type as RecordType, title: passage.title, content: passage.snippet, date: passage.date },
        score: Math.max(0, Math.min(1, passage.similarity ?? passage.score / top)),
      });
      if (results.length >= topK) break;
    }
    return results;
  },

  /** Embeds passages that have no cached vector yet. */
  async reindexBrain(state: BrainState, onProgress?: (current: number, total: number) => void, signal?: AbortSignal) {
    return warmIndex(state, state.openRouterKey, signal, onProgress);
  },

  async getVaultStats(state: BrainState): Promise<VaultStats> {
    const stats = await indexStats(state);
    return {
      total_chunks: stats.passages,
      total_items: stats.records,
      embedded_chunks: stats.embedded,
      vector_dim: stats.dimensions,
      storage_path: "IndexedDB on this device",
      provider: stats.embedded ? "openrouter" : "keyword",
    };
  },
};

/** The former per-item vault kept a second copy of every embedding; it is no longer read. */
export function dropLegacyVault(): void {
  clearVectorVaultDB().catch(() => {});
}
