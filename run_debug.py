import sys
import uvicorn

if __name__ == "__main__":
    print("🚀 Starting FastAPI backend with reload and debug capabilities on http://127.0.0.1:8000...")
    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="debug"
    )
