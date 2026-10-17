from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from app.models import ReportRequest
from app.renderers.pdf_renderer import render_pdf, get_pdf_filename
from app.renderers.docx_renderer import render_docx, get_docx_filename
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/generate")
async def generate_report(request: ReportRequest):
    """Generate PDF or DOCX report from project data."""
    try:
        project = request.project
        fmt = request.format.lower()
        
        if fmt == "pdf":
            content = render_pdf(project)
            filename = get_pdf_filename(project)
            content_type = "application/pdf"
        elif fmt == "docx":
            content = render_docx(project)
            filename = get_docx_filename(project)
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            raise HTTPException(status_code=400, detail="Format must be 'pdf' or 'docx'")
        
        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": content_type,
        }
        
        return Response(content=content, headers=headers, media_type=content_type)
    
    except Exception as e:
        logger.error(f"Report generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "detvision-doc-service"}