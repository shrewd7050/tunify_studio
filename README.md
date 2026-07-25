# Tunify

AI-powered auto-tune and music generation app. Sing a song, and Tunify will auto-tune your voice and generate an AI backing track.

## Features

- **Auto-Tune**: Detects key/scale and corrects pitch in real-time
- **AI Music Generation**: Generates backing tracks from text prompts using MusicGen
- **Full Mix**: Auto-tune vocals + AI backing track = finished song
- **Vocal Separation**: Separate vocals from any track using Demucs

## Architecture

```
tunify/
  backend/          # Python FastAPI server
    src/
      ml/           # ML models (pitch detection, auto-tune, music gen, mixer)
      routes/       # API endpoints
    main.py         # Server entry point
  frontend/         # React Native Expo app
    src/
      screens/      # Record, Process, Results, Generate
      services/     # API client
      styles/       # Theme
```

## Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Backend runs on `http://localhost:8000`

## Frontend Setup

```bash
cd frontend
npm install
npx expo start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/audio/upload` | Upload audio file |
| POST | `/api/audio/autotune` | Auto-tune a vocal track |
| POST | `/api/audio/process` | Full pipeline (auto-tune + generate + mix) |
| POST | `/api/audio/separate` | Separate vocals from accompaniment |
| GET | `/api/audio/analyze/{file}` | Analyze key, tempo, pitch |
| POST | `/api/generate/music` | Generate music from text prompt |
| POST | `/api/generate/accompaniment` | Generate AI accompaniment from audio |
| GET | `/api/audio/download/{file}` | Download processed audio |

## Tech Stack

- **Backend**: Python, FastAPI, librosa, parselmouth, CREPE, MusicGen, Demucs
- **Frontend**: React Native, Expo, expo-av, Navigation
- **ML Models**: Meta MusicGen, CREPE (pitch), Demucs (separation)
