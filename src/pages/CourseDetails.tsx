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
import type { UploadRecord } from "../lib/storage";
import { deleteUpload, uploadSyllabusForCourse, validateSyllabusFile } from "../lib/storage";

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

function bytesToNice(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function CourseDetails() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user, loading } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const titleRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadPct, setUploadPct] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busyUploadId, setBusyUploadId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user || !courseId) return;

    const uploadsRef = collection(db, "users", user.uid, "courses", courseId, "uploads");
    const q = query(uploadsRef, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snap) => {
      const list: UploadRecord[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "Untitled",
          storagePath: data.storagePath ?? "",
          url: data.url ?? "",
          contentType: data.contentType ?? "",
          size: typeof data.size === "number" ? data.size : 0,
          createdAt: data.createdAt,
        };
      });
      setUploads(list);
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

  function pickFile() {
    setUploadError(null);
    fileInputRef.current?.click();
  }

  async function onFileChosen(file: File | null) {
    if (!user || !courseId || !file) return;

    const err = validateSyllabusFile(file);
    if (err) {
      setUploadError(err);
      return;
    }

    setUploading(true);
    setUploadPct(0);
    setUploadError(null);

    try {
      await uploadSyllabusForCourse({
        uid: user.uid,
        courseId,
        file,
        onProgress: (pct) => setUploadPct(pct),
      });
      setUploadPct(100);
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeUpload(u: UploadRecord) {
    if (!user || !courseId) return;
    setBusyUploadId(u.id);
    try {
      await deleteUpload({ uid: user.uid, courseId, uploadId: u.id, storagePath: u.storagePath });
    } catch (e: any) {
      setUploadError(e?.message || "Delete failed.");
    } finally {
      setBusyUploadId(null);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <div className="p-6">Please sign in.</div>;
  if (!courseId) return <div className="p-6">Missing course.</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Course</h1>
          <p className="text-sm opacity-70">Tasks sorted by due date; completed go to the bottom.</p>
        </div>

        <button
          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
          onClick={addBlankTask}
          disabled={creating}
        >
          {creating ? "Adding..." : "+ New task"}
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
                  No tasks yet — click <span className="font-medium">+ New task</span>
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
                      onChange={(e) => updateTask(t.id, { status: e.target.value as TaskStatus })}
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
                      onChange={(e) => updateTask(t.id, { weight: Number(e.target.value) })}
                    />
                  </td>

                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      className="w-16 bg-transparent"
                      value={t.difficulty}
                      onChange={(e) => updateTask(t.id, { difficulty: Number(e.target.value) })}
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <button className="text-sm opacity-60 hover:opacity-100" onClick={() => removeTask(t.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}

            <tr className="border-t">
              <td colSpan={6} className="px-3 py-3">
                <button className="text-sm opacity-70 hover:opacity-100" onClick={addBlankTask} disabled={creating}>
                  + New task
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border p-4 sm:p-5 space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Syllabus uploads</h2>
            <p className="text-sm opacity-70">Upload a PDF/DOCX/TXT. We’ll store it under this course.</p>
          </div>

          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
            />
            <button
              className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
              onClick={pickFile}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>

        {uploadError ? (
          <div className="text-sm rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-700 px-3 py-2">
            {uploadError}
          </div>
        ) : null}

        {uploading ? (
          <div className="space-y-2">
            <div className="text-sm opacity-70">Uploading… {uploadPct}%</div>
            <div className="h-2 rounded-full border overflow-hidden">
              <div className="h-full bg-foreground/30" style={{ width: `${uploadPct}%` }} />
            </div>
            <div className="text-xs opacity-60">Max 10MB. Allowed: PDF, DOC, DOCX, TXT.</div>
          </div>
        ) : null}

        {uploads.length === 0 ? (
          <div className="text-sm opacity-70">No uploads yet.</div>
        ) : (
          <div className="space-y-2">
            {uploads.map((u) => (
              <div
                key={u.id}
                className="rounded-lg border px-3 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.name}</div>
                  <div className="text-xs opacity-60">
                    {u.contentType || "file"} • {bytesToNice(u.size)}
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <a
                    className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                    href={u.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                  <button
                    className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                    onClick={() => removeUpload(u)}
                    disabled={busyUploadId === u.id}
                    title="Delete file"
                  >
                    {busyUploadId === u.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-xs opacity-60">
          Next: add “Extract tasks from syllabus” (we’ll parse text + let you confirm before creating tasks).
        </div>
      </div>
    </div>
  );
}
