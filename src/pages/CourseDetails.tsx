import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

type TaskStatus = "not_started" | "in_progress" | "done";

type Task = {
  id: string;
  title: string;
  dueDate: string;
  status: TaskStatus;
  weight: number;
  difficulty: number;
  createdAt?: any;
};

function dateKey(ymd: string) {
  if (!ymd) return Number.POSITIVE_INFINITY;
  const n = Number(ymd.replaceAll("-", ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function createdAtMs(v: any) {
  if (!v) return Number.POSITIVE_INFINITY;
  if (typeof v?.toMillis === "function") return v.toMillis();
  return Number.POSITIVE_INFINITY;
}

export default function CourseDetails() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user, loading } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState(false);

  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const titleRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!user || !courseId) return;

    const tasksRef = collection(db, "users", user.uid, "courses", courseId, "tasks");
    const q = query(tasksRef, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      const list: Task[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data.title ?? "",
          dueDate: data.dueDate ?? "",
          status: (data.status as TaskStatus) ?? "not_started",
          weight: typeof data.weight === "number" ? data.weight : 0,
          difficulty: typeof data.difficulty === "number" ? data.difficulty : 3,
          createdAt: data.createdAt,
        };
      });
      setTasks(list);
    });

    return () => unsub();
  }, [user, courseId]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status === "done") return -1;

      const ad = dateKey(a.dueDate);
      const bd = dateKey(b.dueDate);
      if (ad !== bd) return ad - bd;

      return createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
    });
  }, [tasks]);

  useEffect(() => {
    if (!focusTaskId) return;
    const el = titleRefs.current[focusTaskId];
    if (el) {
      el.focus();
      el.select();
      setFocusTaskId(null);
    }
  }, [sortedTasks, focusTaskId]);

  async function addBlankTask() {
    if (!user || !courseId) return;
    setCreating(true);

    try {
      const ref = await addDoc(collection(db, "users", user.uid, "courses", courseId, "tasks"), {
        title: "",
        dueDate: "",
        status: "not_started",
        weight: 0,
        difficulty: 3,
        createdAt: serverTimestamp(),
      });

      setFocusTaskId(ref.id);
    } finally {
      setCreating(false);
    }
  }

  async function updateTask(taskId: string, patch: Partial<Task>) {
    if (!user || !courseId) return;

    await updateDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  }

  async function removeTask(taskId: string) {
    if (!user || !courseId) return;
    await deleteDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId));
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <div className="p-6">Please sign in.</div>;
  if (!courseId) return <div className="p-6">Missing course.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm opacity-70">
            Completed tasks automatically move to the bottom.
          </p>
        </div>

        <button
          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
          onClick={addBlankTask}
          disabled={creating}
        >
          {creating ? "Adding..." : "+ New"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Title</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Weight %</th>
              <th className="px-3 py-2 text-left font-medium">Difficulty</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>

          <tbody>
            {sortedTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center opacity-60">
                  No tasks yet — click <span className="font-medium">+ New</span>
                </td>
              </tr>
            ) : (
              sortedTasks.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      ref={(el) => (titleRefs.current[t.id] = el)}
                      className="w-full bg-transparent outline-none"
                      placeholder="Untitled"
                      value={t.title}
                      onChange={(e) => updateTask(t.id, { title: e.target.value })}
                    />
                  </td>

                  <td className="px-3 py-2">
                    <input
                      type="date"
                      className="bg-transparent"
                      value={t.dueDate}
                      onChange={(e) => updateTask(t.id, { dueDate: e.target.value })}
                    />
                  </td>

                  <td className="px-3 py-2">
                    <select
                      className="bg-transparent"
                      value={t.status}
                      onChange={(e) =>
                        updateTask(t.id, { status: e.target.value as TaskStatus })
                      }
                    >
                      <option value="not_started">Not started</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </td>

                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="w-20 bg-transparent"
                      value={t.weight}
                      onChange={(e) =>
                        updateTask(t.id, { weight: Number(e.target.value) })
                      }
                    />
                  </td>

                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      className="w-16 bg-transparent"
                      value={t.difficulty}
                      onChange={(e) =>
                        updateTask(t.id, { difficulty: Number(e.target.value) })
                      }
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-sm opacity-60 hover:opacity-100"
                      onClick={() => removeTask(t.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}

            <tr className="border-t">
              <td colSpan={6} className="px-3 py-3">
                <button
                  className="text-sm opacity-70 hover:opacity-100"
                  onClick={addBlankTask}
                  disabled={creating}
                >
                  + New
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
