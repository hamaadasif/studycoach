import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, db } from "./firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

type AuthCtx = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          await setDoc(
            doc(db, "users", u.uid),
            {
              email: u.email ?? "",
              name: u.displayName ?? "",
              photoURL: u.photoURL ?? "",
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          console.error("Failed to sync user doc:", err);
        }
      }

      if (mounted) {
        setUser(u);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
