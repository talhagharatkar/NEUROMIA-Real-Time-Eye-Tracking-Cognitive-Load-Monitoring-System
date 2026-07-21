<div align="center">

# 🧠 NEUROMIA
### Cognitive Intelligence System — v3.1

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org)
[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-0F9D58?style=for-the-badge&logo=google&logoColor=white)](https://mediapipe.dev)

**Real-time cognitive load monitoring through EEG + oculometrics + LSTM prediction**

</div>

---

## Overview

**Neuromia** is a real-time cognitive intelligence platform designed for neuroscience research. It combines:
- 📡 **EEG signal processing** (live or simulated) with spectral band analysis
- 👁️ **Oculometric analysis** via MediaPipe Face Mesh (468 landmarks)
- 🧠 **3D brain visualization** with real-time region activation (Three.js)
- 🤖 **LSTM neural prediction** for cognitive load, fatigue, and attention forecasting
- 💾 **Research data export** in 4-sheet XLSX and full PDF report

Fully browser-based — no server required for the frontend. All ML runs **client-side in pure JavaScript**.

---

## Features

| Feature | Description |
|---|---|
| **3D Brain Renderer** | Real-time neuroanatomy with 6 labeled regions, orbital pathway visualization |
| **MediaPipe Eye Tracking** | 468-landmark face mesh, EAR blink detection, gaze stability, PERCLOS |
| **EEG Simulation** | Delta/Theta/Alpha/Beta/Gamma spectral analysis, Chart.js waveform |
| **LSTM Predictor** | 2-layer, 24-unit LSTM trained live in-browser on session data |
| **FMG Analysis** | 10 facial muscle group indices (FAI, CBI, JCI, MAR, SmileIdx, etc.) |
| **Emotion Engine** | 8-state real-time emotion inference (Joy, Stress, Fatigue, Confusion, ...) |
| **Subject Registration** | 3-step modal with consent management and subject ID generation |
| **Session History** | 45-session oculometric history with sparkline charts and stats |
| **Report Engine** | Full PDF report + 4-sheet XLSX export (oculometrics, EEG, NASA-TLX) |
| **NASA-TLX Panel** | Task load index rating with 6 sliders and saved submission log |
| **HW Interface** | Pre-wired for WebSerial (USB), WebBluetooth (BLE), WebSocket EEG |

---

## Project Structure

```
neuromia/
├── index.html                    # Main app shell (HTML structure only)
│
├── assets/
│   ├── css/
│   │   └── neuromia.css          # Complete design system
│   └── js/
│       ├── app.js                # Globals, clock, utilities, recording state
│       ├── brain-renderer.js     # Three.js 3D brain + OrbitControls
│       ├── eeg-engine.js         # EEG simulation + spectral analysis
│       ├── oculometric-engine.js # MediaPipe, blink detection, eye tracking
│       ├── hardware-interface.js # Button wiring + EEG hardware interface
│       ├── registration.js       # Subject registration modal
│       ├── report-engine.js      # PDF + 4-sheet XLSX export engine
│       ├── session-history.js    # Oculometric session history engine
│       ├── nasa-tlx.js           # NASA-TLX workload rating panel
│       ├── fmg-engine.js         # Facial Muscle Group + Emotion analysis
│       └── lstm-predictor.js     # LSTM neural prediction engine (pure JS)
│
├── backend/                      # Python research backend
│   ├── main.py                   # Entry point
│   ├── requirements.txt          # Python dependencies
│   ├── models/                   # ML model definitions
│   ├── routes/                   # API route handlers
│   ├── training/                 # Model training scripts
│   ├── utils/                    # Utility functions
│   ├── datasets/                 # Training data
│   ├── cognitive_load_classifier.py
│   ├── emotiv_gateway.py
│   ├── brain_eye_system.py
│   ├── enhance_brain.py
│   ├── fix_brain.py
│   └── patch_keyboard_and_ui.py
│
├── data/
│   └── combined_cognitive_dataset.csv
│
├── docs/
│   └── PROJECT_DOCUMENTATION.md
│
├── .gitignore
└── README.md
```

---

## Getting Started

### One-Command Startup (Recommended)

To run both the backend FastAPI server and the frontend web host simultaneously using one command:

Double-click the **`start.bat`** file in the root directory, or execute it in your terminal:
```bash
.\start.bat
```

This will automatically:
1. Start the FastAPI backend server on `http://127.0.0.1:8000`.
2. Start the lightweight local HTTP server on `http://localhost:8080` (necessary for browser camera permissions).
3. Automatically launch the application in your default browser.
4. Press any key in the terminal window to stop all servers when you're done.

---

### Manual Launch

If you wish to run the parts separately:

#### 1. Frontend (Browser App)
Start an HTTP server at the root directory:
```bash
python -m http.server 8080
```
Then navigate to `http://localhost:8080` in your browser.

#### 2. Backend (Python)
Activate the virtual environment and start uvicorn:
```bash
.venv\Scripts\activate
python -m uvicorn backend.main:app --port 8000
```

---

## Technology Stack

### Frontend
| Technology | Purpose |
|---|---|
| Vanilla HTML / CSS / JS | Core platform (no framework) |
| Three.js r128 | 3D brain visualization |
| Chart.js | EEG waveform + sparkline charts |
| MediaPipe Face Mesh | 468-landmark real-time eye tracking |
| jsPDF 2.5 | PDF report generation |
| SheetJS (xlsx) | 4-sheet XLSX research export |

### Backend (Python)
| Library | Purpose |
|---|---|
| NumPy | Signal processing |
| SciPy | Butterworth IIR filter, Welch PSD |
| OpenCV | Kalman filter, image processing |
| Dlib | 68-point facial landmark detection |
| Pandas | Rolling statistics |

### Supported EEG Hardware
- OpenBCI Cyton / Ganglion (WebSerial USB)
- NeuroSky MindWave (WebBluetooth)
- Muse 2 (WebBluetooth)
- Custom Arduino / ESP32 amplifiers
- Emotiv EPOC (WebSocket gateway)

---

## Research Methodology

### Oculometric Algorithms
- **EAR** (Eye Aspect Ratio) — blink detection from 6 landmarks
- **PERCLOS P80** — drowsiness index from eye closure percentage
- **Kalman Smoother** — gaze stability estimation
- **IIR Butterworth** — signal filtering
- **Zero-Crossing Detection** — IBI (Inter-Blink Interval)

### LSTM Configuration
- Architecture: 2-layer x 24 units
- Features: BlinkRate, GazeStability, Attention, PERCLOS, EAR, Saccade, FixationDensity, EyeStrain
- Sequence length: 10 timesteps
- Optimizer: Adam (lr=0.001)
- Training: Async BPTT, fully in-browser without blocking UI

### Emotion Inference
8-state FMG-derived system (no ML training required):

`Joy | Neutral | Stress | Frustration | Confusion | Fatigue | Anxiety | Surprise`

---

## Data Export Format (XLSX — 4 Sheets)

1. **Oculometric Sessions** — Timestamp, BlinkRate, GazeStability, Attention, PERCLOS, IBI, FatigueIndex, AlertState
2. **EEG Spectral** — Delta/Theta/Alpha/Beta/Gamma power (uV), dominant band
3. **LSTM Predictions** — FatigueForecast, CogLoadForecast, AttentionForecast, BlinkForecast, RiskLevel
4. **NASA-TLX** — MentalDemand, PhysicalDemand, TemporalDemand, Performance, Effort, Frustration, TLX_Score

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m "feat: add your feature"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

This project is developed for academic/research purposes.

---

<div align="center">

**Built with care by the Neuromia Research Team**

*Pushing the boundaries of real-time cognitive intelligence*

</div>
