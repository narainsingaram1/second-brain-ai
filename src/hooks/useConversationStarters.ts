import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainState } from "../types";
import { generateStarters, localStarters, starterFingerprint, type ChatStarter, type ConnectedServices } from "../services/chatSuggestions";
import { getLocalDateString } from "../utils/habitStreaks";

const MAX_AGE_MS = 6 * 3_600_000;
/** How soon a change in what's coming up may trigger another rewrite. */
const MIN_INTERVAL_MS = 10 * 60_000;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

interface CachedStarters { date: string; at: number; fingerprint: string; starters: ChatStarter[] }
const storageKey = (account: string) => `synapse_chat_starters_${account}`;
function readCache(account: string): CachedStarters | null {
  try { return JSON.parse(localStorage.getItem(storageKey(account)) || "null"); } catch { return null; }
}
function writeCache(account: string, value: CachedStarters) {
  try { localStorage.setItem(storageKey(account), JSON.stringify(value)); } catch { /* Regenerated next time. */ }
}

/**
 * Rule-based starters right away, replaced by the model's once they arrive and reused across visits.
 * `personal` is off in temporary chats, which must not read memory or past conversations.
 */
export function useConversationStarters(state: BrainState | null | undefined, visible: boolean, personal: boolean, services: ConnectedServices) {
  const account = state?.userId || "guest";
  const [written, setWritten] = useState<ChatStarter[] | null>(() => readCache(account)?.starters || null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const lastFailure = useRef(0);
  const latest = useRef(state);
  latest.current = state;
  const forced = useRef(false);
  const local = useMemo(
    () => (state ? localStarters(personal ? state : { ...state, conversations: [], agentMemory: undefined }, services) : []),
    [state?.tasks, state?.goals, state?.study, state?.trackerItems, state?.events, state?.conversations, personal, services.calendar, services.gmail],
  );
  const fingerprint = state ? starterFingerprint(state) : "";
  const hasKey = !!state?.openRouterKey?.trim();

  useEffect(() => { setWritten(readCache(account)?.starters || null); }, [account]);
  useEffect(() => {
    if (!visible || !personal || !hasKey || !latest.current) return;
    const now = Date.now(), force = forced.current, cached = readCache(account);
    forced.current = false;
    const current = cached && cached.date === getLocalDateString() && now - cached.at < MAX_AGE_MS && (cached.fingerprint === fingerprint || now - cached.at < MIN_INTERVAL_MS);
    if (!force && current) { setWritten(cached.starters); return; }
    if (!force && now - lastFailure.current < RETRY_AFTER_FAILURE_MS) return;
    const controller = new AbortController();
    setRefreshing(true);
    generateStarters(latest.current, services, AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]))
      .then(starters => {
        if (controller.signal.aborted) return;
        if (!starters.length) { lastFailure.current = Date.now(); return; }
        setWritten(starters);
        writeCache(account, { date: getLocalDateString(), at: Date.now(), fingerprint, starters });
      })
      .catch(() => { if (!controller.signal.aborted) lastFailure.current = Date.now(); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => { controller.abort(); setRefreshing(false); };
  }, [visible, personal, hasKey, account, fingerprint, nonce, services.calendar, services.gmail]);

  return {
    starters: personal && written?.length ? written : local,
    refreshing,
    canRefresh: personal && hasKey,
    refresh: () => { forced.current = true; setNonce(n => n + 1); },
  };
}
