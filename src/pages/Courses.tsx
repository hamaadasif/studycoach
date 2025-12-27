import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";
import { Link } from "react-router-dom";

type CourseRow = {
  id: string;
  name: string;
};

export default function Courses() {
  const { user, loading } = useAuth();

  const [newName, setNewName] = useState("");
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const coursesCol = useMemo(() => {
    if (!user) return null;
    return collection(db, "users", user.uid, "courses");
  }, [user]);

  useEffect(() => {
    if (!coursesCol) return;

    const q = query(coursesCol, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as { name?: unknown };
        return {
          id: d.id,
          name: typeof data.name === "string" ? data.name : "Untitled",
        };
      });
      setCourses(rows);
    });

    return () => unsub();
  }, [coursesCol]);

  async function createCourse() {
    if (!user || !coursesCol) return;
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    try {
      await addDoc(coursesCol, {
        name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(courseId: string) {
    if (!user) return;
    const name = editName.trim();
    if (!name) return;

    setBusyId(courseId);
    try {
      await updateDoc(doc(db, "users", user.uid, "courses", courseId), {
        name,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditName("");
    } finally {
      setBusyId(null);
    }
  }

  async function removeCourse(courseId: string) {
    if (!user) return;

    setBusyId(courseId);
    try {
      const tasksRef = collection(db, "users", user.uid, "courses", courseId, "tasks");

      while (true) {
        const snap = await getDocs(tasksRef);

        if (snap.empty) break;

        const batch = writeBatch(db);
        let count = 0;

        for (const d of snap.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 450) break;
        }

        await batch.commit();

        if (snap.size <= 450) break;
      }

      await deleteDoc(doc(db, "users", user.uid, "courses", courseId));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <div className="p-6">Please sign in to manage courses.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Courses</h1>
        <p className="text-sm opacity-70">
          Add your classes here. Next we’ll add tasks inside each course.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="w-full max-w-md px-3 py-2 rounded-md border bg-background"
          placeholder="e.g., CPS213 Digital Logic"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createCourse();
          }}
          disabled={creating}
        />
        <button
          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
          onClick={createCourse}
          disabled={creating || !newName.trim()}
        >
          {creating ? "Adding..." : "Add"}
        </button>
      </div>

      <div className="space-y-2">
        {courses.length === 0 ? (
          <div className="text-sm opacity-70">No courses yet.</div>
        ) : (
          courses.map((c) => {
            const isEditing = editingId === c.id;
            const isBusy = busyId === c.id;

            return (
              <div key={c.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {!isEditing ? (
                      <Link to={`/courses/${c.id}`} className="font-medium truncate hover:underline">
                        {c.name}
                      </Link>
                    ) : (
                      <input
                        className="w-full px-3 py-2 rounded-md border bg-background"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(c.id);
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditName("");
                          }
                        }}
                        autoFocus
                        disabled={isBusy}
                      />
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!isEditing ? (
                      <button
                        className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditName(c.name);
                        }}
                        disabled={isBusy}
                      >
                        Rename
                      </button>
                    ) : (
                      <>
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => saveEdit(c.id)}
                          disabled={isBusy || !editName.trim()}
                        >
                          {isBusy ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditName("");
                          }}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    <button
                      className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                      onClick={() => removeCourse(c.id)}
                      disabled={isBusy || isEditing}
                      title={isEditing ? "Finish editing first" : "Delete course"}
                    >
                      {isBusy ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
