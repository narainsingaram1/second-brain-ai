import { BrainState, UserAccount, AuthSession } from "../types";

const DB_NAME = "SynapseSecondBrainDB";
const DB_VERSION = 2;

const STORE_USERS = "users";
const STORE_USER_DATA = "user_data";
const STORE_SESSIONS = "sessions";
const STORE_VECTOR_CHUNKS = "vector_chunks";

const SESSION_KEY = "active_session";
const LOCAL_STORAGE_USERS_KEY = "synapse_auth_users";
const LOCAL_STORAGE_SESSION_KEY = "synapse_auth_session";
const LOCAL_STORAGE_USER_DATA_PREFIX = "synapse_user_data_";
const LOCAL_STORAGE_VECTORS_KEY = "synapse_vector_vault_chunks";

let dbInstance: IDBDatabase | null = null;

/**
 * Initializes and returns the IndexedDB database instance.
 */
export async function getDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Users Store: keyed by user ID, indexed by email
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        const userStore = db.createObjectStore(STORE_USERS, { keyPath: "id" });
        userStore.createIndex("email", "email", { unique: true });
      }

      // 2. User Data Store: keyed by userId
      if (!db.objectStoreNames.contains(STORE_USER_DATA)) {
        db.createObjectStore(STORE_USER_DATA, { keyPath: "userId" });
      }

      // 3. Sessions Store: keyed by key ("active_session")
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: "key" });
      }

      // 4. Vector Chunks Store: keyed by chunk id, indexed by itemId and itemType
      if (!db.objectStoreNames.contains(STORE_VECTOR_CHUNKS)) {
        const vectorStore = db.createObjectStore(STORE_VECTOR_CHUNKS, { keyPath: "id" });
        vectorStore.createIndex("item_id", "item_id", { unique: false });
        vectorStore.createIndex("item_type", "item_type", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("IndexedDB open error:", (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

// ==================== USER ACCOUNTS ====================

/**
 * Saves a user account to IndexedDB, Tauri native storage, and LocalStorage.
 */
export async function saveUserToDB(user: UserAccount): Promise<void> {
  // 1. IndexedDB
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_USERS, "readwrite");
      const store = tx.objectStore(STORE_USERS);
      store.put(user);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB saveUser error (falling back to storage):", err);
  }

  // 2. LocalStorage
  try {
    const existing = getAllUsersFromLocalStorage();
    const filtered = existing.filter((u) => u.id !== user.id);
    filtered.push(user);
    localStorage.setItem(LOCAL_STORAGE_USERS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error("Failed to write user to localStorage", e);
  }

  // 3. Tauri Native Disk Storage
  try {
    const all = await getAllUsersFromDB();
    const session = await getSessionFromDB();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_auth_database", {
      usersJson: JSON.stringify(all),
      sessionJson: JSON.stringify(session),
    });
  } catch {
    // Expected in pure browser mode
  }
}

/**
 * Retrieves a user account by email.
 */
export async function getUserByEmailFromDB(email: string): Promise<UserAccount | null> {
  const normEmail = email.trim().toLowerCase();

  // Try IndexedDB
  try {
    const db = await getDatabase();
    const user = await new Promise<UserAccount | null>((resolve) => {
      const tx = db.transaction(STORE_USERS, "readonly");
      const store = tx.objectStore(STORE_USERS);
      const index = store.index("email");
      const req = index.get(normEmail);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (user) return user;
  } catch {
    // Fall back below
  }

  // Fallback: LocalStorage
  const allLocal = getAllUsersFromLocalStorage();
  const match = allLocal.find((u) => u.email.toLowerCase() === normEmail);
  if (match) return match;

  // Fallback: Tauri native storage
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [usersJson] = await invoke<[string | null, string | null]>("load_auth_database");
    if (usersJson) {
      const parsed: UserAccount[] = JSON.parse(usersJson);
      return parsed.find((u) => u.email.toLowerCase() === normEmail) || null;
    }
  } catch {}

  return null;
}

/**
 * Retrieves a user account by ID.
 */
export async function getUserByIdFromDB(id: string): Promise<UserAccount | null> {
  try {
    const db = await getDatabase();
    const user = await new Promise<UserAccount | null>((resolve) => {
      const tx = db.transaction(STORE_USERS, "readonly");
      const store = tx.objectStore(STORE_USERS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (user) return user;
  } catch {}

  const allLocal = getAllUsersFromLocalStorage();
  return allLocal.find((u) => u.id === id) || null;
}

/**
 * Retrieves all registered users in the database.
 */
export async function getAllUsersFromDB(): Promise<UserAccount[]> {
  try {
    const db = await getDatabase();
    const users = await new Promise<UserAccount[]>((resolve) => {
      const tx = db.transaction(STORE_USERS, "readonly");
      const store = tx.objectStore(STORE_USERS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (users && users.length > 0) return users;
  } catch {}

  const local = getAllUsersFromLocalStorage();
  if (local.length > 0) return local;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [usersJson] = await invoke<[string | null, string | null]>("load_auth_database");
    if (usersJson) {
      return JSON.parse(usersJson);
    }
  } catch {}

  return [];
}

function getAllUsersFromLocalStorage(): UserAccount[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ==================== USER DATA / STATE ====================

interface StoredUserDataRecord {
  userId: string;
  state: BrainState;
  updatedAt: string;
}

/**
 * Saves a user's entire BrainState into their personal database record.
 */
export async function saveUserStateToDB(userId: string, state: BrainState): Promise<void> {
  const record: StoredUserDataRecord = {
    userId,
    state: { ...state, userId },
    updatedAt: new Date().toISOString(),
  };

  let saved = false;

  // 1. IndexedDB
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_USER_DATA, "readwrite");
      const store = tx.objectStore(STORE_USER_DATA);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
    });
    saved = true;
  } catch (err) {
    console.warn("IndexedDB saveUserState error:", err);
  }

  // 2. LocalStorage per user
  try {
    localStorage.setItem(`${LOCAL_STORAGE_USER_DATA_PREFIX}${userId}`, JSON.stringify(record.state));
    saved = true;
    // Also keep active state mirror
    localStorage.setItem("synapse_second_brain_state", JSON.stringify(record.state));
  } catch (e) {
    console.error("Failed to write user state to localStorage", e);
  }

  // 3. Tauri Native File per user
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_user_state", {
      userId,
      data: JSON.stringify(record.state),
    });
    saved = true;
  } catch {
    // Expected in browser
  }
  if (!saved) throw new Error("No persistent storage accepted the write.");
}

/**
 * Loads a user's entire BrainState from the database by their userId.
 */
export async function loadUserStateFromDB(userId: string): Promise<BrainState | null> {
  // 1. IndexedDB
  try {
    const db = await getDatabase();
    const record = await new Promise<StoredUserDataRecord | null>((resolve) => {
      const tx = db.transaction(STORE_USER_DATA, "readonly");
      const store = tx.objectStore(STORE_USER_DATA);
      const req = store.get(userId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (record && record.state) {
      return record.state;
    }
  } catch {}

  // 2. Tauri Native File
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const nativeData = await invoke<string | null>("load_user_state", { userId });
    if (nativeData) {
      const parsed = JSON.parse(nativeData);
      return parsed;
    }
  } catch {}

  // 3. LocalStorage
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_USER_DATA_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}

  return null;
}

// ==================== SESSION PERSISTENCE ====================

/**
 * Saves the current auth session (active user or guest).
 */
export async function saveSessionToDB(session: AuthSession): Promise<void> {
  const sessionRecord = {
    key: SESSION_KEY,
    currentUser: session.currentUser,
    isGuest: session.isGuest,
    updatedAt: new Date().toISOString(),
  };

  // 1. IndexedDB
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, "readwrite");
      const store = tx.objectStore(STORE_SESSIONS);
      store.put(sessionRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}

  // 2. LocalStorage
  try {
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(sessionRecord));
  } catch {}

  // 3. Tauri Native
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const all = await getAllUsersFromDB();
    await invoke("save_auth_database", {
      usersJson: JSON.stringify(all),
      sessionJson: JSON.stringify(sessionRecord),
    });
  } catch {}
}

/**
 * Loads the active auth session. Returns guest session if none exists.
 */
export async function getSessionFromDB(): Promise<AuthSession> {
  // 1. IndexedDB
  try {
    const db = await getDatabase();
    const sessionRecord = await new Promise<any>((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (sessionRecord) {
      return {
        currentUser: sessionRecord.currentUser || null,
        isGuest: !!sessionRecord.isGuest,
      };
    }
  } catch {}

  // 2. LocalStorage
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        currentUser: parsed.currentUser || null,
        isGuest: !!parsed.isGuest,
      };
    }
  } catch {}

  // 3. Tauri Native
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [_, sessionJson] = await invoke<[string | null, string | null]>("load_auth_database");
    if (sessionJson) {
      const parsed = JSON.parse(sessionJson);
      return {
        currentUser: parsed.currentUser || null,
        isGuest: !!parsed.isGuest,
      };
    }
  } catch {}

  // Default to Guest
  return {
    currentUser: null,
    isGuest: true,
  };
}

// ==================== VECTOR STORE DATABASE OPERATIONS ====================

/**
 * Saves or updates vector chunks in IndexedDB and LocalStorage fallback.
 */
export async function saveVectorChunksToDB(chunks: any[]): Promise<void> {
  if (!chunks || chunks.length === 0) return;

  // 1. IndexedDB
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VECTOR_CHUNKS, "readwrite");
      const store = tx.objectStore(STORE_VECTOR_CHUNKS);
      for (const chunk of chunks) {
        store.put(chunk);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB saveVectorChunks error (falling back to storage):", err);
  }

  // 2. LocalStorage fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_VECTORS_KEY);
    const existing: any[] = raw ? JSON.parse(raw) : [];
    const map = new Map<string, any>();
    for (const c of existing) map.set(c.id, c);
    for (const c of chunks) map.set(c.id, c);
    localStorage.setItem(LOCAL_STORAGE_VECTORS_KEY, JSON.stringify(Array.from(map.values())));
  } catch (e) {
    console.error("Failed to update vector chunks in localStorage", e);
  }
}

/**
 * Loads all vector chunks from IndexedDB or LocalStorage.
 */
export async function getAllVectorChunksFromDB(): Promise<any[]> {
  // 1. IndexedDB
  try {
    const db = await getDatabase();
    return await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(STORE_VECTOR_CHUNKS, "readonly");
      const store = tx.objectStore(STORE_VECTOR_CHUNKS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB getAllVectorChunks error:", err);
  }

  // 2. LocalStorage fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_VECTORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Deletes vector chunks belonging to an item by itemId.
 */
export async function deleteVectorChunksByItemFromDB(itemId: string): Promise<number> {
  let count = 0;

  // 1. IndexedDB
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VECTOR_CHUNKS, "readwrite");
      const store = tx.objectStore(STORE_VECTOR_CHUNKS);
      const index = store.index("item_id");
      const request = index.getAllKeys(itemId);
      request.onsuccess = () => {
        const keys = request.result;
        count = keys.length;
        for (const key of keys) {
          store.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB deleteVectorChunksByItem error:", err);
  }

  // 2. LocalStorage
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_VECTORS_KEY);
    if (raw) {
      const existing: any[] = JSON.parse(raw);
      const filtered = existing.filter((c) => c.item_id !== itemId);
      count = Math.max(count, existing.length - filtered.length);
      localStorage.setItem(LOCAL_STORAGE_VECTORS_KEY, JSON.stringify(filtered));
    }
  } catch {}

  return count;
}

/**
 * Clears all vector chunks from IndexedDB and LocalStorage.
 */
export async function clearVectorVaultDB(): Promise<void> {
  try {
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VECTOR_CHUNKS, "readwrite");
      tx.objectStore(STORE_VECTOR_CHUNKS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}

  try {
    localStorage.removeItem(LOCAL_STORAGE_VECTORS_KEY);
  } catch {}
}
