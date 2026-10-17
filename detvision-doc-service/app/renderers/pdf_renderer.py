import base64
from io import BytesIO
from weasyprint import HTML, CSS
from jinja2 import Environment, FileSystemLoader
from app.models import DetVisionProject
from app.renderers.diagram import generate_all_diagrams
import pathlib

TEMPLATE_DIR = pathlib.Path(__file__).parent.parent / "templates"

env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))

# Add custom filters
env.filters['percent'] = lambda x: f"{x:.0%}" if isinstance(x, (int, float)) else x


def image_to_base64(img_bytes: bytes) -> str:
    """Convert image bytes to base64 data URI."""
    b64 = base64.b64encode(img_bytes).decode()
    return f"data:image/svg+xml;base64,{b64}"


def format_date(date_str: str) -> str:
    """Format ISO date string for display."""
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return dt.strftime("%B %d, %Y")
    except:
        return date_str


def render_pdf(project: DetVisionProject) -> bytes:
    """Render project as professional PDF report."""
    # Generate diagrams
    diagrams = generate_all_diagrams(project)
    diagram_b64 = {k: image_to_base64(v) for k, v in diagrams.items()}
    
    # Prepare template context
    context = {
        "project": project,
        "diagrams": diagram_b64,
        "format_date": format_date,
        "generated_at": format_date(project.updated_at),
        "output_scope": project.output_scope,
        "coverage_percent": round(100 * sum(bool(zone.camera_ids) for zone in project.zones) / len(project.zones)) if project.zones else 0,
        "layout_sections": project.layout_sections,
    }
    
    # Render HTML
    template = env.get_template("report.html")
    html_content = template.render(**context)
    
    # Generate PDF with WeasyPrint
    css_path = TEMPLATE_DIR / "styles.css"
    pdf_bytes = HTML(string=html_content, base_url=str(TEMPLATE_DIR)).write_pdf(
        stylesheets=[CSS(filename=str(css_path))]
    )
    
    return pdf_bytes


def get_pdf_filename(project: DetVisionProject) -> str:
    safe_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in project.name)
    return f"{safe_name}-plan-vision-blueprint.pdf"
