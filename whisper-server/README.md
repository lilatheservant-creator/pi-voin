# Whisper Server

Local speech-to-text API using [mlx-whisper](https://github.com/ml-explore/mlx-examples) with `whisper-large-v3-turbo` on Apple Silicon.

## Setup

```bash
cd whisper-server

# Create virtual environment
python3 -m venv .
source bin/activate

# Install dependencies
pip install -r requirements.txt

# Download model (first time, ~6GB)
huggingface-cli download mlx-community/whisper-large-v3-turbo --local-dir ~/.omlx/models/whisper-large-v3-turbo
```

## Run

```bash
source bin/activate
python server.py
```

Server starts on `http://127.0.0.1:8002`.

## API

### GET /health

```json
{ "status": "ok", "model": "whisper-large-v3-turbo", "backend": "mlx" }
```

### POST /transcribe

Upload an audio file (WAV, MP3, M4A, etc.).

**Form data:**
- `file`: Audio file (required)
- `task`: "transcribe" (default)
- `without_timestamps`: true/false (default: false)

**Response:**
```json
{
  "text": "Hello, how are you?",
  "language": "en",
  "duration": 1.234
}
```

## Notes

- **Apple Silicon only** — uses MLX (Metal GPU backend)
- Model loads lazily on first `/transcribe` request (~10-30s first load)
- Model cached at `~/.omlx/models/whisper-large-v3-turbo/`
