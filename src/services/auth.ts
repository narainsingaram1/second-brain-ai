import { UserAccount, AuthSession } from "../types";
import {
  saveUserToDB,
  getUserByEmailFromDB,
  getUserByIdFromDB,
  getAllUsersFromDB,
  saveSessionToDB,
  getSessionFromDB,
} from "./database";

/**
 * Computes a secure SHA-256 hash string for password verification.
 */
async function hashPassword(password: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_synapse_salt_#2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Simple fallback hash for older environments
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return `hash_${Math.abs(hash)}`;
}

/**
 * Initializes the auth system and returns the persisted active session.
 */
export async function initAuth(): Promise<AuthSession> {
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
 * Accepts Google user info or prompts with Google account profile.
 */
export async function signInWithGoogle(
  providedEmail?: string,
  providedName?: string,
  providedAvatar?: string
): Promise<{ session: AuthSession; isNewUser: boolean }> {
  const email = (providedEmail || "narainsingaram@gmail.com").trim().toLowerCase();
  const name =
    providedName ||
    email
      .split("@")[0]
      .split(/[._-]/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

  const avatar =
    providedAvatar ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
      name
    )}&backgroundColor=4285F4&textColor=ffffff`;

  const existingUser = await getUserByEmailFromDB(email);
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
      id: `usr_g_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      email,
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
 * Signs up a new user with Name, Email, and Password.
 */
export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
): Promise<AuthSession> {
  const normEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();

  if (!normEmail || !normEmail.includes("@")) {
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
 * Signs in an existing user with Email and Password.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  const normEmail = email.trim().toLowerCase();

  if (!normEmail || !normEmail.includes("@")) {
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

  const inputHash = await hashPassword(password);
  if (user.passwordHash && user.passwordHash !== inputHash) {
    throw new Error("Incorrect password. Please try again.");
  }

  // Update last login
  const updatedUser: UserAccount = {
    ...user,
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
