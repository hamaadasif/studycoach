import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
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

type PlanItem = {
  dayLabel: string;
  entries: Array<{
    taskId: string;
    courseId: string;
    courseName: string;
    title: string;
    hours: number;
    dueDate: string;
    score: number;
    overdue: boolean;
    status: TaskStatus;
  }>;
  totalHours: number;
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function clamp(min: number, v: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function estimateHours(weight: number, difficulty: number) {
  const raw = (weight * difficulty) / 10;
  return clamp(1, Math.round(raw), 10);
}

function isTaskOverdue(dueDate: string, today: Date) {
  if (!dueDate) return false;
  const due = new Date(dueDate + "T00:00:00");
  return daysBetween(today, due) < 0;
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

function statusLabel(s: TaskStatus) {
  if (s === "done") return "Done";
  if (s === "in_progress") return "In progress";
  return "Not started";
}

function statusPillClass(s: TaskStatus) {
  if (s === "done") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  if (s === "in_progress") return "border-blue-500/40 bg-blue-500/10 text-blue-700";
  return "border-zinc-500/30 bg-zinc-500/10 text-zinc-700";
}

export default function Planner() {
  const { user, loading } = useAuth();

  const [hoursPerWeek, setHoursPerWeek] = useState(10);
  const [studyDays, setStudyDays] = useState<number[]>([...ALL_DAYS]);
  const [capOverdue, setCapOverdue] = useState(true);
  const [saving, setSaving] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeekMonday(today), [today]);

  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      const data = snap.data() as any;

      if (typeof data?.hoursPerWeek === "number") setHoursPerWeek(data.hoursPerWeek);

      if (Array.isArray(data?.studyDays) && data.studyDays.length > 0) {
        const cleaned = data.studyDays
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6);
        if (cleaned.length > 0) setStudyDays(cleaned.sort((a: number, b: number) => a - b));
      }

      if (typeof data?.capOverdue === "boolean") setCapOverdue(data.capOverdue);
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadAll() {
      const coursesSnap = await getDocs(collection(db, "users", user.uid, "courses"));
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

  useEffect(() => {
    if (!user) return;

    const active = tasks.filter((t) => t.status !== "done");

    const scored = active
      .map((t) => {
        const overdue = isTaskOverdue(t.dueDate, today);
        const s = scoreTask(t, today);
        const hoursNeeded = estimateHours(t.weight, t.difficulty);
        return { t, s, hoursNeeded, overdue };
      })
      .sort((a, b) => b.s - a.s);

    const enabledDays = studyDays.length > 0 ? studyDays : [0, 1, 2, 3, 4, 5, 6];

    const days: PlanItem[] = enabledDays.map((i) => ({
      dayLabel: `${DAY_NAMES[i]} (${toYMD(addDays(weekStart, i))})`,
      entries: [],
      totalHours: 0,
    }));

    const indexByDay: Array<Map<string, number>> = days.map(() => new Map());

    function addOrMergeEntry(dayIndex: number, entry: PlanItem["entries"][number]) {
      const key = entry.taskId;
      const idxMap = indexByDay[dayIndex];
      const existingIdx = idxMap.get(key);

      if (existingIdx === undefined) {
        idxMap.set(key, days[dayIndex].entries.length);
        days[dayIndex].entries.push(entry);
      } else {
        days[dayIndex].entries[existingIdx].hours += entry.hours;
        days[dayIndex].entries[existingIdx].score = Math.max(days[dayIndex].entries[existingIdx].score, entry.score);
      }

      days[dayIndex].totalHours += entry.hours;
    }

    let budget = clamp(1, Math.round(hoursPerWeek), 80);

    const overdueCap = capOverdue ? Math.floor(budget * 0.6) : Infinity;
    let overdueAllocated = 0;

    const allocatedByTask = new Map<string, number>();

    let dayCursor = 0;

    function canAllocateOverdue(isOverdue: boolean) {
      return !isOverdue || overdueAllocated < overdueCap;
    }

    function allocateHours(item: { t: Task; s: number; overdue: boolean }, hours: number) {
      let remaining = hours;

      while (remaining > 0 && budget > 0 && days.length > 0) {
        if (!canAllocateOverdue(item.overdue)) break;

        const chunk = Math.min(1, remaining);

        addOrMergeEntry(dayCursor, {
          taskId: item.t.id,
          courseId: item.t.courseId,
          courseName: item.t.courseName,
          title: item.t.title,
          hours: chunk,
          dueDate: item.t.dueDate,
          score: item.s,
          overdue: item.overdue,
          status: item.t.status,
        });

        remaining -= chunk;
        budget -= chunk;

        if (item.overdue) overdueAllocated += chunk;

        const prev = allocatedByTask.get(item.t.id) ?? 0;
        allocatedByTask.set(item.t.id, prev + chunk);

        dayCursor = (dayCursor + 1) % days.length;
      }
    }

    const topN = scored.slice(0, 3);
    for (const item of topN) {
      if (budget <= 0) break;
      if (!canAllocateOverdue(item.overdue)) continue;

      const already = allocatedByTask.get(item.t.id) ?? 0;
      if (already >= 1) continue;

      allocateHours(item, 1);
    }

    for (const item of scored) {
      if (budget <= 0) break;
      if (!canAllocateOverdue(item.overdue)) continue;

      const already = allocatedByTask.get(item.t.id) ?? 0;
      const remainingForTask = Math.max(0, item.hoursNeeded - already);
      if (remainingForTask <= 0) continue;

      allocateHours(item, Math.min(remainingForTask, budget));
    }

    for (const d of days) {
      d.entries.sort((a, b) => b.score - a.score);
    }

    setPlan(days);
  }, [tasks, hoursPerWeek, studyDays, capOverdue, user, today, weekStart]);

  async function saveSettings() {
    if (!user) return;
    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        { hoursPerWeek, studyDays, capOverdue, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } finally {
      setSaving(false);
    }
  }

  async function setTaskStatus(courseId: string, taskId: string, status: TaskStatus) {
    if (!user) return;
    setBusyTask(taskId);

    try {
      await updateDoc(doc(db, "users", user.uid, "courses", courseId, "tasks", taskId), {
        status,
        updatedAt: serverTimestamp(),
      });

      setTasks((prev) => prev.map((t) => (t.id === taskId && t.courseId === courseId ? { ...t, status } : t)));
    } finally {
      setBusyTask(null);
    }
  }

  const plannedHours = useMemo(() => plan.reduce((sum, d) => sum + d.totalHours, 0), [plan]);
  const activeCount = useMemo(() => tasks.filter((t) => t.status !== "done").length, [tasks]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <div className="p-6">Please sign in.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planner</h1>
          <p className="text-sm opacity-70">
            Builds your week from due dates, weight, and difficulty — and skips completed tasks.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="px-3 py-2 rounded-md border text-sm">
            <span className="opacity-70">Active tasks:</span> {activeCount}
          </div>
          <div className="px-3 py-2 rounded-md border text-sm">
            <span className="opacity-70">Planned:</span> {plannedHours.toFixed(0)}h / {hoursPerWeek}h
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Study settings</div>
          <button
            className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
            onClick={saveSettings}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="text-xs opacity-70">Hours per week</div>
            <input
              type="number"
              min={1}
              max={80}
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(Number(e.target.value))}
            />
            <div className="text-xs opacity-60">Hours distribute evenly across enabled days (no Monday cramming).</div>
          </div>

          <div className="md:col-span-2 space-y-2">
            <div className="text-xs opacity-70">Study days</div>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((label, i) => {
                const enabled = studyDays.includes(i);
                return (
                  <button
                    key={label}
                    className={`px-3 py-2 rounded-md border text-sm transition ${
                      enabled ? "hover:bg-muted" : "opacity-60 hover:bg-muted"
                    }`}
                    onClick={() => {
                      setStudyDays((prev) => {
                        const has = prev.includes(i);
                        const next = has ? prev.filter((d) => d !== i) : [...prev, i];
                        return next.length === 0 ? prev : next.sort((a, b) => a - b);
                      });
                    }}
                  >
                    {enabled ? "✅ " : "🚫 "}
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                onClick={() => setStudyDays([0, 1, 2, 3, 4])}
              >
                Weekdays only
              </button>
              <button
                className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                onClick={() => setStudyDays([...ALL_DAYS])}
              >
                All days
              </button>

              <label className="ml-auto flex items-center gap-2 px-3 py-2 rounded-md border text-sm">
                <input
                  type="checkbox"
                  checked={capOverdue}
                  onChange={(e) => setCapOverdue(e.target.checked)}
                />
                Cap overdue to 60%
              </label>
            </div>

            <div className="text-xs opacity-60">
              Planner now rotates the starting day while allocating, so hours spread across the week.
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {plan.map((day) => (
          <div key={day.dayLabel} className="rounded-xl border p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{day.dayLabel}</div>
              <div className="text-sm px-2.5 py-1 rounded-full border opacity-80">
                {day.totalHours.toFixed(0)}h
              </div>
            </div>

            {day.entries.length === 0 ? (
              <div className="text-sm opacity-70 mt-3">No assigned study.</div>
            ) : (
              <div className="mt-4 space-y-2">
                {day.entries.map((e) => (
                  <div
                    key={e.taskId}
                    className="rounded-lg border px-3 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-2 py-1 rounded-full border bg-muted">{e.courseName}</span>

                        <span className="font-medium truncate max-w-[60ch]">{e.title}</span>

                        {e.dueDate ? (
                          <span className="text-xs px-2 py-1 rounded-full border opacity-80">Due {e.dueDate}</span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full border opacity-60">No due date</span>
                        )}

                        {e.overdue ? (
                          <span className="text-xs px-2 py-1 rounded-full border bg-rose-500/10 text-rose-700 border-rose-500/30">
                            Overdue
                          </span>
                        ) : null}

                        <span className={`text-xs px-2 py-1 rounded-full border ${statusPillClass(e.status)}`}>
                          {statusLabel(e.status)}
                        </span>
                      </div>

                      <div className="text-xs opacity-60 mt-1">Score {e.score.toFixed(2)}</div>
                    </div>

                    <div className="flex items-center gap-2 justify-between sm:justify-end">
                      <span className="text-sm px-2.5 py-1 rounded-full border">{e.hours}h</span>

                      <div className="flex gap-2">
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => setTaskStatus(e.courseId, e.taskId, "in_progress")}
                          disabled={busyTask === e.taskId}
                        >
                          Start
                        </button>
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => setTaskStatus(e.courseId, e.taskId, "not_started")}
                          disabled={busyTask === e.taskId}
                        >
                          Reset
                        </button>
                        <button
                          className="px-3 py-2 rounded-md border hover:bg-muted text-sm"
                          onClick={() => setTaskStatus(e.courseId, e.taskId, "done")}
                          disabled={busyTask === e.taskId}
                          title="Mark done"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
