import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";

export default function AuthButtons() {
  const { user, loading } = useAuth();

  if (loading) return <div className="text-sm opacity-70">Loading...</div>;

  if (!user) {
    return (
      <button
        className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
        onClick={() => signInWithPopup(auth, googleProvider)}
      >
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm opacity-80">{user.email}</div>
      <button
        className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
        onClick={() => signOut(auth)}
      >
        Sign out
      </button>
    </div>
  );
}
