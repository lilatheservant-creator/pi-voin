"""
Speech-to-Text API using mlx-whisper (whisper-large-v3-turbo) on Apple Silicon.
Runs on Metal GPU — fast on Mac.
Model loads lazily on first /transcribe request.
"""
import os
import tempfile

import mlx_whisper
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse

MODEL_PATH = os.path.expanduser("~/.omlx/models/whisper-large-v3-turbo")

app = FastAPI(title="MLX Whisper STT API", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "model": "whisper-large-v3-turbo", "backend": "mlx"}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    task: str = Form("transcribe"),
    without_timestamps: bool = Form(False),
):
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = mlx_whisper.transcribe(
            tmp_path,
            path_or_hf_repo=MODEL_PATH,
        )

        duration = 0.0
        if result.get("segments"):
            segs = result["segments"]
            duration = segs[-1].get("end", 0) - segs[0].get("start", 0)

        return JSONResponse(content={
            "text": result["text"].strip(),
            "language": result.get("language", "unknown"),
            "duration": round(duration, 3),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8002)
