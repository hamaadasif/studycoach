import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Courses from "./pages/Courses";
import Planner from "./pages/Planner";
import AuthButtons from "./components/AuthButtons";
import CourseDetails from "./pages/CourseDetails"


export default function App() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm ${isActive ? "bg-muted" : "hover:bg-muted"}`;

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="font-semibold">StudyCoach</div>
              <nav className="flex gap-2">
                <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
                <NavLink to="/courses" className={linkClass}>Courses</NavLink>
                <NavLink to="/planner" className={linkClass}>Planner</NavLink>
              </nav>
            </div>

            <AuthButtons />
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/courses/:courseId" element={<CourseDetails />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
