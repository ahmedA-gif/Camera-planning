from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import report
import logging

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="TechHub Plan Vision Document Service",
    description="Professional PDF/DOCX report generation for TechHub Plan Vision projects",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(report.router, prefix="/api/v1/report", tags=["report"])


@app.get("/")
async def root():
    return {
        "service": "TechHub Plan Vision Document Service",
        "version": "1.0.0",
        "endpoints": {
            "generate_report": "POST /api/v1/report/generate",
            "health": "GET /api/v1/report/health",
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
