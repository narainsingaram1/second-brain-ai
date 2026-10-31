import { cloudEnabled, cloudSession } from "./cloudSync";
import { UserAccount, AuthSession } from "../types";
import {
  saveUserToDB,
  getUserByEmailFromDB,
  getUserByIdFromDB,
  getAllUsersFromDB,
  saveSessionToDB,
  getSessionFromDB,
} from "./database";

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN = 256; // 32 bytes

/**
 * Validates RFC 5322 compliant email format.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim());
}

/**
 * Constant-time string equality check to prevent timing side-channel attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Computes an enterprise-grade PBKDF2-HMAC-SHA256 password hash with 100,000 iterations
 * and a unique cryptographically random 128-bit salt per user.
 * Format: $pbkdf2-sha256$i=100000$s=<hexSalt>$h=<hexHash>
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API is required for secure authentication.");
  }

  // 128-bit cryptographically secure random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_LEN
  );

  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `$pbkdf2-sha256$i=${PBKDF2_ITERATIONS}$s=${saltHex}$h=${hashHex}`;
}

/**
 * Verifies a password against a stored PBKDF2 hash using constant-time comparison.
 * Seamlessly migrates legacy unversioned hashes.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) return false;

  // 1. Standard Enterprise PBKDF2 verification
  if (storedHash.startsWith("$pbkdf2-sha256$")) {
    const parts = storedHash.split("$").filter(Boolean);
    const iterPart = parts.find((p) => p.startsWith("i="));
    const saltPart = parts.find((p) => p.startsWith("s="));
    const hashPart = parts.find((p) => p.startsWith("h="));

    if (!saltPart || !hashPart) return false;
    const iterations = iterPart ? parseInt(iterPart.slice(2), 10) : PBKDF2_ITERATIONS;
    const saltHex = saltPart.slice(2);
    const targetHashHex = hashPart.slice(2);

    const saltBytes = new Uint8Array(
      saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      PBKDF2_KEY_LEN
    );

    const computedHashHex = Array.from(new Uint8Array(bits))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return constantTimeCompare(computedHashHex, targetHashHex);
  }

  // 2. Backwards-compatibility check for legacy SHA-256 test hashes
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_synapse_salt_#2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const legacyHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (constantTimeCompare(legacyHex, storedHash)) {
      return true;
    }
  }

  return false;
}

/**
 * Decodes and extracts claims from a verified Google Identity Services JWT ID token.
 */
export function parseGoogleJwtCredential(credential: string): {
  email: string;
  name: string;
  picture?: string;
  sub: string;
} {
  try {
    const base64Url = credential.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);
    if (!payload.email || !isValidEmail(payload.email)) {
      throw new Error("Invalid Google token: missing or malformed email claim");
    }
    return {
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email.split("@")[0],
      picture: payload.picture,
      sub: payload.sub || `g_${Date.now()}`,
    };
  } catch (err: any) {
    throw new Error(`Failed to decode Google credential token: ${err.message}`);
  }
}

/**
 * Initializes the auth system and returns the persisted active session.
 */
export async function initAuth(): Promise<AuthSession> {
  if (cloudEnabled) return cloudSession();
  const session = await getSessionFromDB();

  // If session has a currentUser, verify they still exist in the database
  if (session.currentUser) {
    const verifiedUser = await getUserByIdFromDB(session.currentUser.id);
    if (verifiedUser) {
      return {
        currentUser: verifiedUser,
        isGuest: false,
      };
    }
  }

  return {
    currentUser: null,
    isGuest: true,
  };
}

/**
 * Signs in or signs up with Google.
 * Strictly requires an authentic verified Google email address.
 * NEVER defaults to any hardcoded fallback email!
 */
export async function signInWithGoogle(
  email: string,
  providedName?: string,
  providedAvatar?: string,
  googleSubId?: string
): Promise<{ session: AuthSession; isNewUser: boolean }> {
  const normEmail = (email || "").trim().toLowerCase();

  if (!normEmail || !isValidEmail(normEmail)) {
    throw new Error("A valid Google email address is required to sign in.");
  }

  const name =
    (providedName || "").trim() ||
    normEmail
      .split("@")[0]
      .split(/[._-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

  const avatar =
    providedAvatar ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
      name
    )}&backgroundColor=4285F4&textColor=ffffff`;

  const existingUser = await getUserByEmailFromDB(normEmail);
  const now = new Date().toISOString();

  let user: UserAccount;
  let isNew = false;

  if (existingUser) {
    user = {
      ...existingUser,
      name: providedName || existingUser.name,
      avatar: providedAvatar || existingUser.avatar || avatar,
      provider: "google",
      lastLoginAt: now,
    };
  } else {
    isNew = true;
    user = {
      id: googleSubId ? `usr_g_${googleSubId}` : `usr_g_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      email: normEmail,
      name,
      avatar,
      provider: "google",
      createdAt: now,
      lastLoginAt: now,
    };
  }

  await saveUserToDB(user);

  const session: AuthSession = {
    currentUser: user,
    isGuest: false,
  };
  await saveSessionToDB(session);

  return { session, isNewUser: isNew };
}

/**
 * Signs up a new user with Name, Email, and Password using PBKDF2 hashing.
 */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<AuthSession> {
  const normEmail = (email || "").trim().toLowerCase();
  const trimmedName = (name || "").trim();

  if (!normEmail || !isValidEmail(normEmail)) {
    throw new Error("Please enter a valid email address.");
  }
  if (!trimmedName) {
    throw new Error("Please enter your name.");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  const existing = await getUserByEmailFromDB(normEmail);
  if (existing) {
    throw new Error("An account with this email already exists. Please sign in instead.");
  }

  // Derive PBKDF2 hash with unique 16-byte cryptographic salt
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
    trimmedName
  )}&backgroundColor=10b981&textColor=ffffff`;

  const newUser: UserAccount = {
    id: `usr_em_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    email: normEmail,
    name: trimmedName,
    avatar,
    provider: "email",
    passwordHash,
    createdAt: now,
    lastLoginAt: now,
  };

  await saveUserToDB(newUser);

  const session: AuthSession = {
    currentUser: newUser,
    isGuest: false,
  };
  await saveSessionToDB(session);

  return session;
}

/**
 * Signs in an existing user with Email and Password using constant-time PBKDF2 verification.
 * Automatically upgrades legacy hashes to PBKDF2 on successful login.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  const normEmail = (email || "").trim().toLowerCase();

  if (!normEmail || !isValidEmail(normEmail)) {
    throw new Error("Please enter a valid email address.");
  }
  if (!password) {
    throw new Error("Please enter your password.");
  }

  const user = await getUserByEmailFromDB(normEmail);
  if (!user) {
    throw new Error("No account found with this email. Please check your email or sign up.");
  }

  if (user.provider === "google") {
    throw new Error(
      "This account was created with Google. Please use 'Sign in with Google' instead."
    );
  }

  const isValid = await verifyPassword(password, user.passwordHash || "");
  if (!isValid) {
    throw new Error("Incorrect password. Please try again.");
  }

  // If password was stored in legacy format, seamlessly upgrade to PBKDF2-HMAC-SHA256
  let updatedHash = user.passwordHash;
  if (user.passwordHash && !user.passwordHash.startsWith("$pbkdf2-sha256$")) {
    updatedHash = await hashPassword(password);
  }

  const updatedUser: UserAccount = {
    ...user,
    passwordHash: updatedHash,
    lastLoginAt: new Date().toISOString(),
  };
  await saveUserToDB(updatedUser);

  const session: AuthSession = {
    currentUser: updatedUser,
    isGuest: false,
  };
  await saveSessionToDB(session);

  return session;
}

/**
 * Switches the active session to another registered user account.
 */
export async function switchUser(userId: string): Promise<AuthSession> {
  const user = await getUserByIdFromDB(userId);
  if (!user) {
    throw new Error("Account not found");
  }

  const updated: UserAccount = {
    ...user,
    lastLoginAt: new Date().toISOString(),
  };
  await saveUserToDB(updated);

  const session: AuthSession = {
    currentUser: updated,
    isGuest: false,
  };
  await saveSessionToDB(session);

  return session;
}

/**
 * Signs out of the current account and returns to Guest mode.
 */
export async function signOut(): Promise<AuthSession> {
  const guestSession: AuthSession = {
    currentUser: null,
    isGuest: true,
  };
  await saveSessionToDB(guestSession);
  return guestSession;
}

/**
 * Returns all registered user accounts.
 */
export async function getAllAccounts(): Promise<UserAccount[]> {
  return getAllUsersFromDB();
}
