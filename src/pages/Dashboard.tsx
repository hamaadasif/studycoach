import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

type TaskStatus = "not_started" | "in_progress" | "done";

type Task = {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  dueDate: string;
  weight: number;
  difficulty: number;
  status: TaskStatus;
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function clamp(min: number, v: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function startOfWeekMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay(); 
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(a: Date, b: Date) {
  const ms = 24 * 60 * 60 * 1000;
  const aa = new Date(a);
  aa.setHours(0, 0, 0, 0);
  const bb = new Date(b);
  bb.setHours(0, 0, 0, 0);
  return Math.round((bb.getTime() - aa.getTime()) / ms);
}

function isOverdue(dueDate: string, today: Date) {
  if (!dueDate) return false;
  const due = new Date(dueDate + "T00:00:00");
  return daysBetween(today, due) < 0;
}

function daysUntilDue(dueDate: string, today: Date) {
  if (!dueDate) return null;
  const due = new Date(dueDate + "T00:00:00");
  return daysBetween(today, due);
}

function scoreTask(t: Task, today: Date) {
  let daysUntil = 14;
  if (t.dueDate) {
    const due = new Date(t.dueDate + "T00:00:00");
    const raw = daysBetween(today, due);
    daysUntil = raw <= 0 ? 3 : clamp(1, raw, 365);
  }
  const urgency = 1 / daysUntil;
  return (t.weight || 0) * (t.difficulty || 3) * urgency;
}

function estimateHours(weight: number, difficulty: number) {
  const raw = (weight * difficulty) / 10;
  return clamp(1, Math.round(raw), 10);
}

function statusPillClass(s: TaskStatus) {
  if (s === "done") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  if (s === "in_progress") return "border-blue-500/40 bg-blue-500/10 text-blue-700";
  return "border-zinc-500/30 bg-zinc-500/10 text-zinc-700";
}

function statusLabel(s: TaskStatus) {
  if (s === "done") return "Done";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

export default function Dashboard() {
  const { user, loading } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [courseCount, setCourseCount] = useState(0);

  const [hoursPerWeek, setHoursPerWeek] = useState(10);
  const [studyDays, setStudyDays] = useState<number[]>([...ALL_DAYS]);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeekMonday(today), [today]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = snap.data() as any;
      if (typeof data?.hoursPerWeek === "number") setHoursPerWeek(data.hoursPerWeek);

      if (Array.isArray(data?.studyDays) && data.studyDays.length > 0) {
        const cleaned = data.studyDays
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6);
        if (cleaned.length > 0) setStudyDays(cleaned.sort((a: number, b: number) => a - b));
      }
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadAll() {
      const coursesSnap = await getDocs(collection(db, "users", user.uid, "courses"));
      if (!cancelled) setCourseCount(coursesSnap.size);

      const courseList = coursesSnap.docs.map((d) => ({
        id: d.id,
        name: (d.data() as any)?.name ?? "Untitled",
      }));

      const all: Task[] = [];

      for (const c of courseList) {
        const tasksSnap = await getDocs(collection(db, "users", user.uid, "courses", c.id, "tasks"));
        for (const td of tasksSnap.docs) {
          const data = td.data() as any;

          const status: TaskStatus =
            data?.status === "done" || data?.status === "in_progress" || data?.status === "not_started"
              ? data.status
              : "not_started";

          all.push({
            id: td.id,
            courseId: c.id,
            courseName: c.name,
            title: typeof data?.title === "string" ? data.title : "Untitled",
            dueDate: typeof data?.dueDate === "string" ? data.dueDate : "",
            weight: typeof data?.weight === "number" ? data.weight : 0,
            difficulty: typeof data?.difficulty === "number" ? data.difficulty : 3,
            status,
          });
        }
      }

      if (!cancelled) setTasks(all);
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function setTaskStatus(courseId: string, taskId: string, status: TaskStatus) {
    if (!user) return;
    setBusyTask(taskId);
    try {
      await updateDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId), {
        status,
        updatedAt: serverTimestamp(),
      });

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId && t.courseId === courseId ? { ...t, status } : t))
      );
    } finally {
      setBusyTask(null);
    }
  }

  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);

  const focusTasks = useMemo(() => {
    return [...activeTasks]
      .map((t) => ({
        ...t,
        score: scoreTask(t, today),
        overdue: isOverdue(t.dueDate, today),
        dueIn: daysUntilDue(t.dueDate, today),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [activeTasks, today]);

  const overdueTasks = useMemo(() => {
    return [...activeTasks]
      .filter((t) => isOverdue(t.dueDate, today))
      .sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99"))
      .slice(0, 5);
  }, [activeTasks, today]);

  const dueSoonTasks = useMemo(() => {
    return [...activeTasks]
      .map((t) => ({ t, dueIn: daysUntilDue(t.dueDate, today) }))
      .filter((x) => x.dueIn !== null && x.dueIn! >= 0 && x.dueIn! <= 7)
      .sort((a, b) => a.dueIn! - b.dueIn!)
      .slice(0, 6)
      .map((x) => x.t);
  }, [activeTasks, today]);

  const plannedThisWeek = useMemo(() => {
    const enabledDays = studyDays.length > 0 ? studyDays : [0, 1, 2, 3, 4, 5, 6];
    const dayCount = enabledDays.length;

    let budget = clamp(1, Math.round(hoursPerWeek), 80);

    const scored = [...activeTasks]
      .map((t) => ({ t, s: scoreTask(t, today), hoursNeeded: estimateHours(t.weight, t.difficulty) }))
      .sort((a, b) => b.s - a.s);

    const allocatedByTask = new Map<string, number>();
    let total = 0;
    let cursor = 0;

    function alloc(taskId: string, amount: number) {
      const prev = allocatedByTask.get(taskId) ?? 0;
      allocatedByTask.set(taskId, prev + amount);
      total += amount;
      cursor = (cursor + 1) % dayCount;
    }

    for (const item of scored.slice(0, 3)) {
      if (budget <= 0) break;
      const already = allocatedByTask.get(item.t.id) ?? 0;
      if (already >= 1) continue;
      budget -= 1;
      alloc(item.t.id, 1);
    }

    for (const item of scored) {
      if (budget <= 0) break;
      const already = allocatedByTask.get(item.t.id) ?? 0;
      const remaining = Math.max(0, item.hoursNeeded - already);
      if (remaining <= 0) continue;

      const take = Math.min(remaining, budget);
      budget -= take;
      alloc(item.t.id, take);
    }

    return total;
  }, [activeTasks, hoursPerWeek, studyDays, today]);

  const weekRangeLabel = useMemo(() => {
    const start = toYMD(weekStart);
    const end = toYMD(addDays(weekStart, 6));
    return `${start} → ${end}`;
  }, [weekStart]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <div className="p-6">Please sign in.</div>;

  if (courseCount === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome 👋</h1>
        <p className="text-sm opacity-70">
          You don’t have any courses yet. Add one to start organizing assignments and building a study plan.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Link className="px-4 py-2 rounded-md border hover:bg-muted text-sm" to="/courses">
            ➕ Add a course
          </Link>
          <Link className="px-4 py-2 rounded-md border hover:bg-muted text-sm" to="/planner">
            Open Planner
          </Link>
        </div>
      </div>
    );
  }

  if (courseCount > 0 && tasks.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
        <p className="text-sm opacity-70">
          Your courses are set up, but you haven’t added any assignments yet. Open a course and click{" "}
          <span className="font-medium">+ New</span> to add tasks.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Link className="px-4 py-2 rounded-md border hover:bg-muted text-sm" to="/courses">
            Open courses
          </Link>
          <Link
            className="px-4 py-2 rounded-md border opacity-50 pointer-events-none text-sm"
            to="/planner"
            aria-disabled="true"
          >
            Planner
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm opacity-70">Your next moves, due dates, and weekly progress.</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link className="px-3 py-2 rounded-md border hover:bg-muted text-sm" to="/planner">
            Open Planner
          </Link>
          <Link className="px-3 py-2 rounded-md border hover:bg-muted text-sm" to="/courses">
            Courses
          </Link>
        </div>
      </div>

      <div className="rounded-xl border p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">This week</div>
            <div className="text-sm opacity-70">{weekRangeLabel}</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-2 rounded-md border text-sm">
              <span className="opacity-70">Planned:</span> {plannedThisWeek.toFixed(0)}h / {hoursPerWeek}h
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs opacity-60">
          Tip: change hours/days on the Planner page — dashboard updates automatically.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border p-4 sm:p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">🔥 Focus now</div>
            <div className="text-xs opacity-60">Top 5 by priority</div>
          </div>

          {focusTasks.length === 0 ? (
            <div className="mt-4 text-sm opacity-70">No active tasks — you’re caught up.</div>
          ) : (
            <div className="mt-4 space-y-2">
              {focusTasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border px-3 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs px-2 py-1 rounded-full border bg-muted">{t.courseName}</span>
                      <span className="font-medium truncate max-w-[60ch]">{t.title}</span>

                      {t.dueDate ? (
                        <span className="text-xs px-2 py-1 rounded-full border opacity-80">
                          Due {t.dueDate}
                          {typeof t.dueIn === "number" ? ` • ${t.dueIn < 0 ? "overdue" : `${t.dueIn}d`}` : ""}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full border opacity-60">No due date</span>
                      )}

                      {t.overdue ? (
                        <span className="text-xs px-2 py-1 rounded-full border bg-rose-500/10 text-rose-700 border-rose-500/30">
                          Overdue
                        </span>
                      ) : null}

                      <span className={`text-xs px-2 py-1 rounded-full border ${statusPillClass(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </div>

                    <div className="text-xs opacity-60 mt-1">
                      Weight {t.weight}% • Difficulty {t.difficulty}/5 • Score {t.score.toFixed(2)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 justify-end">
                    <Link
                      className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                      to={`/courses/${t.courseId}`}
                      title="Open course tasks"
                    >
                      Open
                    </Link>

                    <button
                      className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                      onClick={() => setTaskStatus(t.courseId, t.id, "in_progress")}
                      disabled={busyTask === t.id}
                    >
                      Start
                    </button>
                    <button
                      className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                      onClick={() => setTaskStatus(t.courseId, t.id, "done")}
                      disabled={busyTask === t.id}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4 sm:p-5">
            <div className="font-medium">📅 Due soon (7 days)</div>
            {dueSoonTasks.length === 0 ? (
              <div className="mt-3 text-sm opacity-70">Nothing due in the next week.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {dueSoonTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs opacity-70">{t.courseName}</div>
                      <div className="text-sm font-medium truncate">{t.title}</div>
                      <div className="text-xs opacity-60">Due {t.dueDate || "—"}</div>
                    </div>
                    <Link className="text-sm opacity-70 hover:opacity-100" to={`/courses/${t.courseId}`}>
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border p-4 sm:p-5">
            <div className="font-medium">🚨 Overdue</div>
            {overdueTasks.length === 0 ? (
              <div className="mt-3 text-sm opacity-70">No overdue tasks.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {overdueTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs opacity-70">{t.courseName}</div>
                      <div className="text-sm font-medium truncate">{t.title}</div>
                      <div className="text-xs opacity-60">Due {t.dueDate || "—"}</div>
                    </div>
                    <button
                      className="text-sm opacity-70 hover:opacity-100"
                      onClick={() => setTaskStatus(t.courseId, t.id, "in_progress")}
                      disabled={busyTask === t.id}
                    >
                      Start
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="px-3 py-2 rounded-md border">
            <div className="text-xs opacity-70">Active tasks</div>
            <div className="text-lg font-semibold">{activeTasks.length}</div>
          </div>
          <div className="px-3 py-2 rounded-md border">
            <div className="text-xs opacity-70">Done tasks</div>
            <div className="text-lg font-semibold">{tasks.filter((t) => t.status === "done").length}</div>
          </div>
          <div className="px-3 py-2 rounded-md border">
            <div className="text-xs opacity-70">Courses</div>
            <div className="text-lg font-semibold">{courseCount}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
