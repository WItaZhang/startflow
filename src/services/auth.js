import { createClient } from "@supabase/supabase-js";

const LOCAL_AUTH_KEY = "startflow-local-session-v1";

export function createAuthController() {
  const supabase = createSupabaseClient();
  return supabase ? createSupabaseAuth(supabase) : createLocalAuth();
}

function createSupabaseClient() {
  const env = import.meta.env || {};
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

function createSupabaseAuth(client) {
  return {
    mode: "cloud",
    client,
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session ? normalizeSession(data.session, "cloud") : null;
    },
    onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        callback(session ? normalizeSession(session, "cloud") : null);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return normalizeSession(data.session, "cloud");
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      return data.session ? normalizeSession(data.session, "cloud") : null;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
  };
}

function createLocalAuth() {
  const listeners = new Set();

  const emit = (session) => {
    listeners.forEach((listener) => listener(session));
  };

  return {
    mode: "local",
    client: null,
    async getSession() {
      return readLocalSession();
    },
    onAuthChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async signIn(email) {
      const session = makeLocalSession(email);
      localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(session));
      emit(session);
      return session;
    },
    async signUp(email) {
      return this.signIn(email);
    },
    async signOut() {
      localStorage.removeItem(LOCAL_AUTH_KEY);
      emit(null);
    }
  };
}

function normalizeSession(session, mode) {
  if (!session?.user) return null;
  return {
    mode,
    user: {
      id: session.user.id,
      email: session.user.email || "未命名用户"
    }
  };
}

function readLocalSession() {
  try {
    const raw = localStorage.getItem(LOCAL_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function makeLocalSession(email) {
  const normalizedEmail = String(email || "demo@startflow.local").trim().toLowerCase();
  return {
    mode: "local",
    user: {
      id: `local-${hashString(normalizedEmail)}`,
      email: normalizedEmail
    }
  };
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
