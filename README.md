# StudyCoach

StudyCoach is a full-stack web app that helps students turn raw course syllabi into a structured study plan.  
Users can upload their syllabus, automatically extract assignments using AI, and get a prioritized weekly planner based on deadlines, weights, and difficulty.

**Live Demo:** https://studycoach-five.vercel.app/

This project focuses on real-world academic workflows rather than idealized data.

---

## Features

- **Authentication**
  - Google Sign-In via Firebase Auth
  - Per-user data isolation

- **Courses & Tasks**
  - Create courses
  - Add, edit, and delete assignments
  - Task status tracking (Not started / In progress / Done)
  - Notion-style table interface

- **AI Syllabus Extraction**
  - Upload syllabus PDFs
  - Server-side PDF parsing
  - AI-assisted extraction of assignments, weights, and dates
  - Review and confirm tasks before importing

- **Planner**
  - Weekly study hour budgeting
  - Prioritization based on due dates, assignment weight, and difficulty
  - Automatically excludes completed tasks

- **Cloud Architecture**
  - Firebase Firestore for data storage
  - Firebase Storage for file uploads
  - Express backend for AI processing
  - Frontend deployed on Vercel

---

## Tech Stack

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS

### Backend
- Node.js (Express)
- OpenAI API
- PDF parsing (`@bingsjs/pdf-parse`)

### Infrastructure
- Firebase Authentication
- Firestore
- Firebase Storage
