import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
import { db } from "../lib/firebase";
import { useAuth } from "../lib/AuthContext";

type TaskStatus = "not_started" | "in_progress" | "done";

type TaskRow = {
  id: string;
  title: string;
  dueDate: string; 
  weight: number;
  difficulty: number;
  status: TaskStatus;
};

export default function CourseDetails() {
  const { user, loading } = useAuth();
  const { courseId } = useParams();

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [weight, setWeight] = useState(10);
  const [difficulty, setDifficulty] = useState(3);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Omit<TaskRow, "id"> | null>(null);

  const tasksCol = useMemo(() => {
    if (!user || !courseId) return null;
    return collection(db, "users", user.uid, "courses", courseId, "tasks");
  }, [user, courseId]);

  useEffect(() => {
    if (!tasksCol) return;

    const q = query(tasksCol, orderBy("dueDate", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: TaskRow[] = snap.docs.map((d) => {
        const data = d.data() as Partial<TaskRow>;
        return {
          id: d.id,
          title: typeof data.title === "string" ? data.title : "Untitled",
          dueDate: typeof data.dueDate === "string" ? data.dueDate : "",
          weight: typeof data.weight === "number" ? data.weight : 0,
          difficulty: typeof data.difficulty === "number" ? data.difficulty : 3,
          status:
            data.status === "done" || data.status === "in_progress" || data.status === "not_started"
              ? data.status
              : "not_started",
        };
      });
      setTasks(rows);
    });

    return () => unsub();
  }, [tasksCol]);

  async function createTask() {
    if (!user || !courseId || !tasksCol) return;
    const t = title.trim();
    if (!t) return;

    setBusyId("create");
    try {
      await addDoc(tasksCol, {
        title: t,
        dueDate,
        weight,
        difficulty,
        status: "not_started" as TaskStatus,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTitle("");
      setDueDate("");
      setWeight(10);
      setDifficulty(3);
    } finally {
      setBusyId(null);
    }
  }

  async function saveTask(taskId: string) {
    if (!user || !courseId || !edit) return;

    setBusyId(taskId);
    try {
      await updateDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId), {
        ...edit,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEdit(null);
    } finally {
      setBusyId(null);
    }
  }

  async function removeTask(taskId: string) {
    if (!user || !courseId) return;

    setBusyId(taskId);
    try {
      await deleteDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId));
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(taskId: string, status: TaskStatus) {
    if (!user || !courseId) return;

    setBusyId(taskId);
    try {
      await updateDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId), {
        status,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <div className="p-6">Please sign in.</div>;
  if (!courseId) return <div className="p-6">Missing course id.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Course Tasks</h1>
        <p className="text-sm opacity-70">Add assessments and track progress.</p>
      </div>

      {/* Create */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="font-medium">Add Task</div>

        <input
          className="w-full px-3 py-2 rounded-md border bg-background"
          placeholder="e.g., Midterm 1, Assignment 2, Quiz"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Due date</div>
            <input
              type="date"
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Weight (%)</div>
            <input
              type="number"
              min={0}
              max={100}
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs opacity-70">Difficulty (1–5)</div>
            <input
              type="number"
              min={1}
              max={5}
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
            />
          </div>

          <div className="flex items-end">
            <button
              className="w-full px-3 py-2 rounded-md border hover:bg-muted text-sm"
              onClick={createTask}
              disabled={busyId === "create" || !title.trim()}
            >
              {busyId === "create" ? "Adding..." : "Add Task"}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-sm opacity-70">No tasks yet.</div>
        ) : (
          tasks.map((t) => {
            const isBusy = busyId === t.id;
            const isEditing = editingId === t.id;

            return (
              <div key={t.id} className="rounded-md border p-3 space-y-3">
                {!isEditing ? (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-sm opacity-70">
                        Due: {t.dueDate || "—"} • Weight: {t.weight}% • Difficulty: {t.difficulty}/5
                      </div>
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <button
                          className="px-3 py-1.5 rounded-md border hover:bg-muted text-xs"
                          onClick={() => setStatus(t.id, "not_started")}
                          disabled={isBusy}
                        >
                          Not started
                        </button>
                        <button
                          className="px-3 py-1.5 rounded-md border hover:bg-muted text-xs"
                          onClick={() => setStatus(t.id, "in_progress")}
                          disabled={isBusy}
                        >
                          In progress
                        </button>
                        <button
                          className="px-3 py-1.5 rounded-md border hover:bg-muted text-xs"
                          onClick={() => setStatus(t.id, "done")}
                          disabled={isBusy}
                        >
                          Done
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                        onClick={() => {
                          setEditingId(t.id);
                          setEdit({
                            title: t.title,
                            dueDate: t.dueDate,
                            weight: t.weight,
                            difficulty: t.difficulty,
                            status: t.status,
                          });
                        }}
                        disabled={isBusy}
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                        onClick={() => removeTask(t.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <input
                        className="md:col-span-2 w-full px-3 py-2 rounded-md border bg-background"
                        value={edit?.title ?? ""}
                        onChange={(e) => setEdit((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                        disabled={isBusy}
                      />
                      <input
                        type="date"
                        className="w-full px-3 py-2 rounded-md border bg-background"
                        value={edit?.dueDate ?? ""}
                        onChange={(e) => setEdit((prev) => (prev ? { ...prev, dueDate: e.target.value } : prev))}
                        disabled={isBusy}
                      />
                      <select
                        className="w-full px-3 py-2 rounded-md border bg-background"
                        value={edit?.status ?? "not_started"}
                        onChange={(e) =>
                          setEdit((prev) =>
                            prev ? { ...prev, status: e.target.value as TaskStatus } : prev
                          )
                        }
                        disabled={isBusy}
                      >
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="w-full px-3 py-2 rounded-md border bg-background"
                        value={edit?.weight ?? 0}
                        onChange={(e) =>
                          setEdit((prev) => (prev ? { ...prev, weight: Number(e.target.value) } : prev))
                        }
                        disabled={isBusy}
                      />
                      <input
                        type="number"
                        min={1}
                        max={5}
                        className="w-full px-3 py-2 rounded-md border bg-background"
                        value={edit?.difficulty ?? 3}
                        onChange={(e) =>
                          setEdit((prev) => (prev ? { ...prev, difficulty: Number(e.target.value) } : prev))
                        }
                        disabled={isBusy}
                      />

                      <div className="md:col-span-2 flex gap-2">
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => saveTask(t.id)}
                          disabled={isBusy || !(edit?.title ?? "").trim()}
                        >
                          {isBusy ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => {
                            setEditingId(null);
                            setEdit(null);
                          }}
                          disabled={isBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
