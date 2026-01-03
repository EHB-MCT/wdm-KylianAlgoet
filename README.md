# ♟️ ChessMirror WMD

ChessMirror WMD is a **local-only research prototype** that explores how player behavior in a chess environment can be **observed, analyzed, and subtly influenced** through UX interventions.

The project does **not** aim to improve chess strength, but focuses on **metacognition**:
*how players think, how quickly they decide, and how these patterns respond to small UX nudges.*

---

## 🎯 Project Purpose

This prototype was developed as an **exploratory research project** within Web & Mobile Development (WMD).

It demonstrates:

- **Behavioral data collection** (events, timing, focus)
- **User profiling** based on anonymous UIDs
- **Visualization of cognitive patterns** (think time, blunders, trends)
- **Subtle UX interventions** without forcing behavior
- A clear separation between **player UI** and **admin analysis**

---

## 🧠 Concept: “Mirror, not coach”

ChessMirror is **not a coach** and **not a chess engine**.

The system:
- does **not** suggest best moves
- does **not** actively correct players
- does **not** alter game rules

Instead, it acts as a **mirror**:
observing behavior and reflecting patterns back to the user — optionally influenced by light UX nudges.

---

## 🧩 Core Features

### 👤 Player (frontend)
- Automatic anonymous UID (no accounts)
- Tracking of:
  - move timing
  - hover events
  - window focus / blur
  - navigation
- Optional UX nudges:
  - move confirmation prompt
  - “take a second” text nudge

### 🛠️ Admin dashboard
- Overview of all active UIDs
- Per user:
  - total moves
  - blunder rate
  - average think time
  - hint usage
- Chart: **think time trend**
- Live event samples
- Toggleable interventions per UID

---

## 🗃️ Data & Privacy

- ❌ No accounts
- ❌ No personal data
- ❌ No external tracking
- ✅ All data stored locally
- ✅ Data linked only to a **random UID**

The project is intentionally **privacy-minimal**.

---

## 🏗️ Tech Stack

**Frontend**
- React
- Vite
- Vanilla CSS
- Chart.js

**Backend**
- Node.js
- Express
- Prisma ORM

**Database**
- PostgreSQL

**Infrastructure**
- Docker
- Docker Compose

---

## 🚀 Installation & Usage

### Requirements
- Docker
- Docker Compose

