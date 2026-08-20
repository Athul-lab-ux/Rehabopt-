# 🩺 RehabOpt — AI-Powered Webcam Rehabilitation System

Real-time upper-limb stroke rehabilitation using **MediaPipe Pose + Hand tracking** running entirely in the browser. No GPU server required — every visitor uses their own webcam.

## Features

- **10 Guided Exercises** — step-locked rep counting with live feedback
- **9 Hand-Driven Games** — Star Catch, Bubble Pop, Flappy Reach, Fist Pop, Wrist Hammer, and more
- **Drawing Session** — 9 trace shapes + custom canvas
- **AI Chat** — Gemini-powered rehabilitation guidance
- **PDF Reports** — clinical-grade session reports
- **7 Mathematical Concepts** — Vector Geometry, L2 Distance, Spatial Variance, FFT, Finite Differences, Savitzky-Golay, Quadratic Programming

## Quick Start

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:8000
```

## Deployment

```bash
# Railway / Render — just connect this repo
# Camera works because MediaPipe runs in the browser
```

## Tech Stack

- **Backend:** Flask + SQLite
- **Frontend:** Vanilla JS + HTML5 Canvas
- **Tracking:** MediaPipe Pose + Hand (browser-side, CDN-loaded)
- **AI:** Google Gemini API
- **PDF:** ReportLab

## Mathematical Concepts

| # | Concept | Purpose |
|---|---------|---------|
| C1 | Vector Geometry | Joint angles (elbow, wrist) |
| C2 | L2 Distance | Target reach / collision detection |
| C3 | Spatial Variance | Fist vs finger-spread classification |
| C4 | FFT | Pathological tremor detection (4-12 Hz) |
| S1 | Finite Differences | Velocity, acceleration, jerk |
| S2 | Savitzky-Golay Filter | Camera noise removal |
| S3 | Quadratic Programming | Minimum-jerk optimal trajectory |
