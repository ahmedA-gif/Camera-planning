import base64
from io import BytesIO
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from app.models import DetVisionProject, UseCase, Camera, Zone, WorkflowNode, NodeCategory, FeasibilityStatus
from app.renderers.diagram import generate_all_diagrams, NODE_ICONS, NODE_COLORS
import pathlib


def set_cell_shading(cell, color_hex: str):
    """Set background color for a table cell."""
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), color_hex.replace("#", ""))
    shading.set(qn("w:val"), "clear")
    cell._tc.get_or_add_tcPr().append(shading)


def add_heading_styled(doc: Document, text: str, level: int, color: str = "#1E293B"):
    heading = doc.add_heading(text, level=level)
    for run in heading.runs:
        run.font.color.rgb = RGBColor.from_string(color.replace("#", ""))
    return heading


def add_styled_paragraph(doc: Document, text: str, bold: bool = False, color: str = "#334155", size: int = 11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color.replace("#", ""))
    run.font.size = Pt(size)
    run.font.name = 'Calibri'
    return p


def add_bullet_list(doc: Document, items: list, color: str = "#334155", indent: int = 0):
    for item in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.left_indent = Inches(0.5 + indent * 0.25)
        run = p.add_run(item)
        run.font.color.rgb = RGBColor.from_string(color.replace("#", ""))
        run.font.size = Pt(10)
        run.font.name = 'Calibri'


def add_table_with_style(doc: Document, headers: list, rows: list, col_widths: list = None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Light Grid Accent 1'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    
    # Header row
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = header
        for paragraph in cell.paragraphs:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in paragraph.runs:
                run.bold = True
                run.font.size = Pt(9)
                run.font.name = 'Calibri'
                run.font.color.rgb = RGBColor(255, 255, 255)
        set_cell_shading(cell, "#1E293B")
    
    # Data rows
    for r_idx, row in enumerate(rows):
        for c_idx, val in enumerate(row):
            cell = table.rows[r_idx + 1].cells[c_idx]
            cell.text = str(val)
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(9)
                    run.font.name = 'Calibri'
            if r_idx % 2 == 0:
                set_cell_shading(cell, "#F8FAFC")
    
    if col_widths:
        for i, width in enumerate(col_widths):
            for row in table.rows:
                row.cells[i].width = Inches(width)
    
    return table


def feasibility_badge(status: FeasibilityStatus) -> tuple:
    """Return (text, color) for feasibility status."""
    colors = {
        FeasibilityStatus.FEASIBLE: ("✓ Feasible", "#10B981"),
        FeasibilityStatus.CONDITIONAL: ("⚠ Conditional", "#F59E0B"),
        FeasibilityStatus.INFEASIBLE: ("✗ Infeasible", "#EF4444"),
        FeasibilityStatus.UNKNOWN: ("? Unknown", "#64748B"),
    }
    return colors.get(status, ("Unknown", "#64748B"))


def status_badge(status) -> tuple:
    """Return (text, color) for camera status."""
    colors = {
        "active": ("Active", "#10B981"),
        "installed": ("Installed", "#3B82F6"),
        "planned": ("Planned", "#64748B"),
        "maintenance": ("Maintenance", "#F59E0B"),
        "offline": ("Offline", "#EF4444"),
    }
    s = status.value if hasattr(status, 'value') else str(status).lower()
    return colors.get(s, (s.title(), "#64748B"))


def render_docx(project: DetVisionProject) -> bytes:
    """Render project as professional DOCX report."""
    doc = Document()
    
    # Set default style
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(11)
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = 1.15
    
    # Adjust margins
    for section in doc.sections:
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(2.54)
        section.right_margin = Cm(2.54)
    
    # Generate diagrams
    diagrams = generate_all_diagrams(project)
    
    # ===== COVER PAGE =====
    logo_path = pathlib.Path(__file__).parents[1] / "templates" / "techhub-logo.png"
    if logo_path.exists():
        logo_para = doc.add_paragraph()
        logo_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        logo_para.add_run().add_picture(str(logo_path), width=Inches(3.4))
    for _ in range(4):
        doc.add_paragraph()
    
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run(project.name)
    run.bold = True
    run.font.size = Pt(36)
    run.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
    run.font.name = 'Calibri'
    
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run("Technical Blueprint")
    run.font.size = Pt(20)
    run.font.color.rgb = RGBColor(0x3B, 0x82, 0xF6)
    run.font.name = 'Calibri'
    
    doc.add_paragraph()
    
    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = meta.add_run(f"{project.company_name}  |  {project.industry}")
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)
    
    doc.add_paragraph()
    
    date_para = doc.add_paragraph()
    date_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = date_para.add_run(f"Generated: {format_date(project.updated_at)}")
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
    
    doc.add_page_break()
    
    # ===== TABLE OF CONTENTS =====
    add_heading_styled(doc, "Table of Contents", 1)
    toc_items = [
        "1. Executive Summary",
        "2. Business Objectives & Scope",
        "3. Use Case Analysis",
        "4. Proposed Vision Techniques",
        "5. Camera Inventory & Assignments",
        "5A. Field Rigging & Camera Installation Package",
        "5B. Computer Vision & Software Developer Package",
        "6. Detection Zones & Virtual Lines",
        "7. Computer Vision Workflow",
        "8. Technical Assumptions",
        "9. Missing Information & Risks",
        "10. Hardware & Software Categories",
        "11. Consolidated Acceptance Criteria",
        "12. Implementation Roadmap",
    ]
    toc_labels = {
        "1.": "Executive summary", "2.": "Executive summary", "3.": "Use cases", "4.": "Use cases",
        "5.": "Camera plan", "5A.": "Camera plan", "5B.": "Camera plan", "6.": "Detection coverage", "7.": "Workflow", "8.": "Assumptions & open questions",
        "9.": "Assumptions & open questions", "10.": "Hardware & critical components", "11.": "Use cases", "12.": "Implementation roadmap",
    }
    toc_items = [item for item in toc_items if not project.output_scope or item.split()[0] not in toc_labels or toc_labels[item.split()[0]] in project.output_scope]
    for item in toc_items:
        p = doc.add_paragraph(item)
        p.paragraph_format.space_after = Pt(4)
        for run in p.runs:
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
    
    doc.add_page_break()
    
    if not project.output_scope or "Executive summary" in project.output_scope:
        # ===== 1. EXECUTIVE SUMMARY =====
        add_heading_styled(doc, "1. Executive Summary", 1)
        add_styled_paragraph(doc, project.business_description)
        if project.facility_image:
            try:
                encoded = project.facility_image.split(',', 1)[-1]
                image_stream = BytesIO(base64.b64decode(encoded))
                add_styled_paragraph(doc, f"Site reference: {project.facility_image_name or 'Uploaded image'}", bold=True, size=12)
                doc.add_picture(image_stream, width=Inches(5.8))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                if project.image_observation:
                    add_styled_paragraph(doc, project.image_observation, size=9, color="#64748B")
            except Exception:
                add_styled_paragraph(doc, "A site image was attached but could not be embedded in this document.", size=9, color="#64748B")
        add_styled_paragraph(doc, f"Layout plan: {project.layout_section_count or 1} section(s) · {project.detection_coverage_target or 90}% target detection coverage. Confirm coverage through a site survey and field-of-view review.", size=10)
        if project.camera_specifications:
            add_styled_paragraph(doc, f"Camera specifications: {project.camera_specifications}", size=10)
    
        doc.add_paragraph()
        add_styled_paragraph(doc, "Project Overview", bold=True, size=12)
    
        overview_rows = [
            ["Use Cases", str(len(project.use_cases))],
            ["Cameras", str(len(project.cameras))],
            ["Zones / Lines", str(len(project.zones))],
            ["Workflow Nodes", str(len(project.workflow.nodes))],
            ["Feasible Use Cases", str(sum(1 for u in project.use_cases if u.feasibility_status == FeasibilityStatus.FEASIBLE))],
            ["Conditional Use Cases", str(sum(1 for u in project.use_cases if u.feasibility_status == FeasibilityStatus.CONDITIONAL))],
            ["Assumptions", str(len(project.assumptions))],
            ["Missing Information Items", str(len(project.missing_information))],
        ]
        add_table_with_style(doc, ["Metric", "Value"], overview_rows, [4, 2])
    
        doc.add_page_break()
    
    if not project.output_scope or "Executive summary" in project.output_scope:
        # ===== 2. BUSINESS OBJECTIVES & SCOPE =====
        add_heading_styled(doc, "2. Business Objectives & Scope", 1)
    
        if project.requirements:
            add_styled_paragraph(doc, "Requirements", bold=True, size=12)
            for req in project.requirements:
                p = doc.add_paragraph(style='List Bullet')
                run = p.add_run(req)
                run.font.size = Pt(11)
                run.font.name = 'Calibri'
    
        doc.add_paragraph()
        add_styled_paragraph(doc, "Project Metadata", bold=True, size=12)
        meta_rows = [
            ["Project ID", project.id],
            ["Created", format_date(project.created_at)],
            ["Last Updated", format_date(project.updated_at)],
            ["Company", project.company_name],
            ["Industry", project.industry],
        ]
        add_table_with_style(doc, ["Field", "Value"], meta_rows, [3, 5])
    
        doc.add_page_break()
    
    if not project.output_scope or "Use cases" in project.output_scope:
        # ===== 3. USE CASE ANALYSIS =====
        add_heading_styled(doc, "3. Use Case Analysis", 1)
    
        if not project.use_cases:
            add_styled_paragraph(doc, "No use cases generated yet. Run scenario analysis to populate.", color="#EF4444")
        else:
            # Summary table
            uc_rows = []
            for uc in project.use_cases:
                badge_text, badge_color = feasibility_badge(uc.feasibility_status)
                uc_rows.append([
                    uc.name,
                    uc.task_type.value.replace("_", " ").title(),
                    badge_text,
                    str(len(uc.camera_ids)),
                    ", ".join(uc.candidate_techniques[:2]) + ("..." if len(uc.candidate_techniques) > 2 else "")
                ])
            add_table_with_style(doc, 
                ["Use Case", "Type", "Feasibility", "Cameras", "Key Techniques"],
                uc_rows, [2, 1.5, 1.5, 0.8, 2.5])
        
            doc.add_paragraph()
        
            # Detailed cards
            for uc in project.use_cases:
                add_heading_styled(doc, f"3.{project.use_cases.index(uc)+1} {uc.name}", 2)
            
                badge_text, badge_color = feasibility_badge(uc.feasibility_status)
                p = doc.add_paragraph()
                run = p.add_run(f"Feasibility: {badge_text}")
                run.font.color.rgb = RGBColor.from_string(badge_color.replace("#", ""))
                run.bold = True
                run.font.size = Pt(10)
            
                add_styled_paragraph(doc, uc.description, size=10)
            
                # Input/Output
                detail_rows = [
                    ["Input", uc.input_description],
                    ["Output", uc.output_description],
                ]
                add_table_with_style(doc, ["Field", "Description"], detail_rows, [1.5, 6])
            
                # Techniques
                if uc.candidate_techniques:
                    add_styled_paragraph(doc, "Candidate Techniques:", bold=True, size=10)
                    add_bullet_list(doc, uc.candidate_techniques, color="#1E293B")
            
                # Feasibility notes
                if uc.feasibility_notes:
                    add_styled_paragraph(doc, "Feasibility Notes:", bold=True, size=10)
                    add_bullet_list(doc, uc.feasibility_notes, color="#F59E0B")
            
                # Acceptance criteria
                if uc.acceptance_criteria:
                    add_styled_paragraph(doc, "Acceptance Criteria:", bold=True, size=10)
                    for criteria in uc.acceptance_criteria:
                        p = doc.add_paragraph(style='List Bullet')
                        run = p.add_run("✓ ")
                        run.font.color.rgb = RGBColor(0x10, 0xB9, 0x81)
                        run2 = p.add_run(criteria)
                        run2.font.size = Pt(10)
                        run2.font.name = 'Calibri'
            
                doc.add_paragraph()
    
        doc.add_page_break()
    
    if not project.output_scope or "Use cases" in project.output_scope:
        # ===== 4. PROPOSED TECHNIQUES =====
        add_heading_styled(doc, "4. Proposed Vision Techniques", 1)
    
        all_techniques = {}
        for uc in project.use_cases:
            for tech in uc.candidate_techniques:
                if tech not in all_techniques:
                    all_techniques[tech] = []
                all_techniques[tech].append(uc.name)
    
        tech_rows = []
        for tech, use_cases in all_techniques.items():
            tech_rows.append([tech, ", ".join(use_cases)])
        add_table_with_style(doc, ["Technique", "Applicable Use Cases"], tech_rows, [3, 5])
        
        doc.add_paragraph()

        # Multi-Standard Camera Mapping Frameworks (DORI, OODPCVS, Johnson's, DHS/NIJ, French)
        add_styled_paragraph(doc, "Multi-Standard Camera Mapping & Resolution Frameworks", bold=True, size=12)
        add_styled_paragraph(doc, "All proposed cameras and optics are dimensioned according to international standards (IEC 62676-4:2025, US Military NVESD, US DHS/NIJ, and French Municipal Code) to guarantee analytical and forensic precision:", size=10)
        
        standards_rows = [
            ["DORI (IEC 2015)", "Visible Light", "px/m (PPM)", "Detect (25), Observe (62.5), Recognize (125), Identify (250)", "Baseline European CCTV standard for security surveillance & human activity."],
            ["OODPCVS (IEC 2025)", "Visible Ultra-HD/AI", "px/m (PPM)", "Overview (20), Outline (40), Discern (80), Perceive (125), Characterize (250), Validate (500), Scrutinize (1500)", "Evolution of DORI for 4K/8K AI sensors. Scrutinize tier guarantees passport-grade biometric facial recognition."],
            ["Johnson's Criteria", "Thermal IR", "Line Pairs (lp)", "Detection (1.0–1.5 lp), Recognition (3.0–4.0 lp), Identification (6.0–8.0 lp)", "US Military thermal imaging standard across target object dimensions (human 1.8m, vehicle 2.3m)."],
            ["US DHS / NIJ", "Forensic Video", "% Vert Screen Height", "General (5%), Classification (10%), Forensic Evidence ID (≥15% VSH), High-Security ID (≥25% VSH)", "Forensic court admissibility. A suspect's face must occupy ≥15% of vertical frame height for conviction."],
            ["French Standards", "Public Municipal", "px/m (PPM)", "Surveillance (30), Reconnaissance (150), Identification Stricte (300), Contrôle d'Accès (800)", "French public safety regulation and JVSG CCTV design tool standard."],
        ]
        add_table_with_style(doc, ["Standard", "Domain", "Metric Unit", "Resolution Tiers & Thresholds", "Analytical Objective & Evidence Level"], standards_rows, [1.3, 1.1, 1.1, 2.3, 2.2])

        doc.add_paragraph()

        # Optical Physics, Thermal Line Pairs, VSH & 3D Raycasting Occlusion Formulas
        add_styled_paragraph(doc, "Mathematical Formulations for Multi-Standard & 3D Bird-Eye Mapping", bold=True, size=12)
        math_text = (
            "1. Ground Pixel Density Formulation (PPM):\n"
            "   PPM(D) = Resolution_Width / [ 2 · D · tan(HFOV / 2) ]\n"
            "   Where D is line-of-sight slant range to target plane (1.5m AFF).\n\n"
            "2. Thermal Camera Johnson's Criteria Line-Pair Formula:\n"
            "   N_lp = [ PPM(D) · H_target ] / 2 = [ Res_W · H_target ] / [ 4 · D · tan(HFOV / 2) ]\n"
            "   Thermal cameras measure line pairs resolved across a target object (human 1.8m, vehicle 2.3m).\n"
            "   Identification requires 6–8 lp; Recognition requires 3–4 lp; Detection requires 1–1.5 lp.\n\n"
            "3. US DHS / NIJ % Vertical Screen Height Formulation:\n"
            "   VSH_% = [ H_target / (2 · D · tan(VFOV / 2)) ] × 100%\n"
            "   For court-admissible forensic evidence under NIJ standards, face must occupy ≥15% VSH.\n\n"
            "4. 3D Bird Camera View & Under-Camera Blind Zone Trigonometry:\n"
            "   D_blind = (Mount_Elevation - Target_Elevation) / tan(Tilt_Angle + VFOV / 2)\n"
            "   Top-down 3D bird's-eye projection with 3D ray-box slab intersection testing against physical\n"
            "   obstacles. Longitudinal aisle aiming eliminates dead-zone occlusions behind storage racks."
        )
        p_math = doc.add_paragraph()
        run_math = p_math.add_run(math_text)
        run_math.font.name = 'Consolas'
        run_math.font.size = Pt(9.0)
        run_math.font.color.rgb = RGBColor(0x03, 0x69, 0xA1)

        doc.add_page_break()
    
    if not project.output_scope or "Camera plan" in project.output_scope:
        # ===== 5. CAMERA INVENTORY =====
        add_heading_styled(doc, "5. Camera Inventory & Assignments", 1)
        if project.camera_recommendations:
            add_styled_paragraph(doc, "Suggested camera details", bold=True, size=12)
            add_bullet_list(doc, project.camera_recommendations)
            add_styled_paragraph(doc, "Preliminary recommendations; validate lens, mounting, lighting, and pixel density on site.", size=9, color="#64748B")
    
        if not project.cameras:
            add_styled_paragraph(doc, "No cameras configured. Use Camera Map to add cameras.", color="#EF4444")
        else:
            cam_rows = []
            for cam in project.cameras:
                status_text, status_color = status_badge(cam.status)
                assigned_ucs = []
                for uc_id in cam.assigned_use_case_ids:
                    uc = next((u for u in project.use_cases if u.id == uc_id), None)
                    if uc:
                        assigned_ucs.append(uc.name)
                cam_rows.append([
                    cam.name,
                    status_text,
                    f"({cam.x:.0%}, {cam.y:.0%})",
                    f"{cam.orientation_degrees}°",
                    f"{cam.horizontal_fov_degrees}° / {cam.view_range:.0%}",
                    f"{cam.resolution_width}×{cam.resolution_height}",
                    ", ".join(assigned_ucs) if assigned_ucs else "—"
                ])
            add_table_with_style(doc,
                ["Camera", "Status", "Position", "Orientation", "FOV/Range", "Resolution", "Assigned Use Cases"],
                cam_rows, [1.2, 0.8, 1, 0.8, 1.2, 1, 2])
        
            doc.add_paragraph()
        
            # Camera detail cards
            add_styled_paragraph(doc, "Camera Details", bold=True, size=12)
            for cam in project.cameras:
                status_text, status_color = status_badge(cam.status)
                p = doc.add_paragraph()
                run = p.add_run(f"📷 {cam.name}")
                run.bold = True
                run.font.size = Pt(11)
            
                detail_rows = [
                    ["Status", status_text],
                    ["Position", f"({cam.x:.1%}, {cam.y:.1%})"],
                    ["Orientation", f"{cam.orientation_degrees}°"],
                    ["Horizontal FOV", f"{cam.horizontal_fov_degrees}°"],
                    ["View Range", f"{cam.view_range:.0%}"],
                    ["Resolution", f"{cam.resolution_width} × {cam.resolution_height}"],
                ]
                add_table_with_style(doc, ["Property", "Value"], detail_rows, [2, 4])
            
                if cam.assigned_use_case_ids:
                    add_styled_paragraph(doc, "Assigned Use Cases:", bold=True, size=10)
                    for uc_id in cam.assigned_use_case_ids:
                        uc = next((u for u in project.use_cases if u.id == uc_id), None)
                        if uc:
                            p = doc.add_paragraph(style='List Bullet')
                            run = p.add_run(uc.name)
                            run.font.size = Pt(10)
                doc.add_paragraph()
    
        # Camera Map Diagram
        if "camera_map" in diagrams:
            doc.add_paragraph()
            add_styled_paragraph(doc, "Camera Layout Diagram", bold=True, size=12)
            try:
                img_stream = BytesIO(diagrams["camera_map"])
                doc.add_picture(img_stream, width=Inches(6.5))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            except:
                pass

        # Site layout elements (buildings, obstacles, entrances)
        if project.structure:
            doc.add_paragraph()
            add_styled_paragraph(doc, "Site layout elements", bold=True, size=12)
            structure_rows = [
                [
                    element.name,
                    element.type.title(),
                    " · ".join(f"({point.x:.2f}, {point.y:.2f})" for point in element.points[:8]),
                ]
                for element in project.structure
            ]
            add_table_with_style(doc, ["Element", "Type", "Points (normalized 0–1)"], structure_rows, [2, 1.2, 4])

        doc.add_page_break()

        # ===== 5A. FIELD RIGGING & CAMERA INSTALLATION PACKAGE =====
        add_heading_styled(doc, "5A. Field Rigging & Camera Installation Package", 1)
        add_styled_paragraph(
            doc,
            "NOTICE FOR FIELD RIGGING & ELECTRICAL CREW: All physical coordinates, dropper pole drops, pan/tilt angles, and cable pull assignments must be verified against ceiling trusses and existing structural beams before drilling. Ensure weatherproof IP67 cable glands and drip loops are installed on all outdoor/loading dock runs.",
            bold=True, size=10, color="#D97706"
        )
        
        # Rigging schedule table
        add_styled_paragraph(doc, "Rigging & Mounting Schedule", bold=True, size=12)
        rigging_rows = []
        for i, cam in enumerate(project.cameras or []):
            mount_type = getattr(cam, 'mounting_type', 'Universal Wall / Parapet') or 'Universal Wall / Parapet'
            fx = cam.x * (project.facility_width_m or 90)
            fy = cam.y * (project.facility_length_m or 30)
            fz = getattr(cam, 'mount_height_m', 4.5) or 4.5
            tilt = getattr(cam, 'tilt_degrees', 22) or 22
            dropper = getattr(cam, 'dropper_pole_m', 'Flush') or 'Flush'
            cat6_run = int(cam.x * 60 + cam.y * 30 + 15)
            rigging_rows.append([
                cam.name,
                mount_type,
                f"({fx:.1f}m, {fy:.1f}m)",
                f"{fz:.1f}m AFF",
                f"{cam.orientation_degrees}°",
                f"-{tilt}° / {dropper}",
                f"Port {i + 1} · {cat6_run}m Cat6"
            ])
        if rigging_rows:
            add_table_with_style(
                doc,
                ["Camera", "Mount Type", "Coord (X,Y)", "Elevation", "Pan", "Tilt/Pole", "PoE Port & Run"],
                rigging_rows,
                [1.1, 1.4, 1.0, 0.9, 0.7, 1.0, 1.3]
            )
        
        doc.add_paragraph()

        # Infrastructure & Power Budget Table
        add_styled_paragraph(doc, "Infrastructure & Power Budget", bold=True, size=12)
        cam_count = len(project.cameras or [])
        infra_rows = [
            ["Cabling Standard", "Shielded Cat6 STP (Solid Bare Copper, 23 AWG)", "TIA-568-C.2 (Max 90m permanent link)"],
            ["Power Delivery", "IEEE 802.3af PoE (Class 3, 15.4W / port)", "Direct from Managed Industrial Switch"],
            ["Total Power Draw", f"{cam_count * 9.5:.1f} W nominal / {cam_count * 15.4:.1f} W peak", "Allocate minimum 300W UPS battery backup"],
            ["Environmental Protection", "IP67 Ingress Protection, IK10 Vandal Resistance", "Required on all perimeter, bay & dock mounts"],
        ]
        add_table_with_style(doc, ["Parameter", "Specification / Value", "Field Standard"], infra_rows, [1.8, 2.7, 2.7])

        doc.add_paragraph()

        # 5-Point Technician Sign-off Checklist Table
        add_styled_paragraph(doc, "Field Rigging & Technician Sign-Off Checklist", bold=True, size=12)
        checklist_rows = [
            ["1", "Mechanical Anchor & Torque", "3/8\" drop-in anchors torqued to 25 ft-lbs with lock washers", "[  ] Passed  Date: ________"],
            ["2", "Cable Run & Fluke Test", "Cat6 certified (< 0.5dB loss, 1000BASE-T link negotiated)", "[  ] Passed  Date: ________"],
            ["3", "Aiming & Optical Alignment", "Pan and tilt angles match schedule within ±1.5 degrees", "[  ] Passed  Date: ________"],
            ["4", "Weatherproof Seal & Drip Loop", "Silicone dielectric gasket seated, 150mm drip loop below gland", "[  ] Passed  Date: ________"],
            ["5", "Night-Vision IR & Focus", "Varifocal focus locked; zero IR reflection from nearby walls/pipes", "[  ] Passed  Date: ________"],
        ]
        add_table_with_style(doc, ["#", "Verification Item", "Standard Requirement", "Technician Sign-off"], checklist_rows, [0.4, 2.2, 3.0, 1.8])

        doc.add_page_break()

        # ===== 5B. COMPUTER VISION & SOFTWARE DEVELOPER PACKAGE =====
        add_heading_styled(doc, "5B. Computer Vision & Software Developer Package", 1)
        add_styled_paragraph(
            doc,
            "NOTICE FOR SOFTWARE DEVELOPERS & CV ENGINEERS: This package defines RTSP ingest endpoints, network credentials, target pixel densities (IEC EN 62676-4 DORI standard), deep learning inference pipeline topology, and edge GPU VRAM allocation.",
            bold=True, size=10, color="#2563EB"
        )

        # Stream Ingestion & RTSP Schema Table
        add_styled_paragraph(doc, "Stream Ingestion & RTSP Schema", bold=True, size=12)
        rtsp_rows = []
        for i, cam in enumerate(project.cameras or []):
            model = "YOLOv8x-pose (PPE)" if i % 3 == 0 else ("ByteTrack + ReID" if i % 3 == 1 else "RT-DETR (Hazards)")
            dori = "125 PPM (Recognize)" if i == 0 else "62 PPM (Observe)"
            rtsp_rows.append([
                cam.name,
                f"rtsp://cv-svc:VisionSec2026@192.168.10.{101 + i}:554/live/ch0",
                f"H.265 / {cam.resolution_width}x{cam.resolution_height} @ 25fps",
                "4096 kbps CBR",
                model,
                dori
            ])
        if rtsp_rows:
            add_table_with_style(
                doc,
                ["Camera", "RTSP URI (Main Stream)", "Codec / Res / FPS", "Bitrate", "DL Model", "Min DORI"],
                rtsp_rows,
                [1.0, 2.2, 1.6, 0.9, 1.2, 1.0]
            )

        doc.add_paragraph()

        # NVIDIA DeepStream / GStreamer Pipeline Architecture
        add_styled_paragraph(doc, "Pipeline Architecture (NVIDIA DeepStream / GStreamer)", bold=True, size=12)
        pipeline_box = (
            f"[RTSP Source x {cam_count} Streams]\n"
            "    │ (NVMM Memory / Hardware H.265 Depay)\n"
            "    ▼\n"
            f"[nvv4l2decoder] ➔ [nvstreammux (batch-size={cam_count}, width=1920, height=1080)]\n"
            "    │\n"
            "    ▼\n"
            "[nvinfer (Primary Detector: TensorRT INT8 YOLOv8 / RT-DETR)]\n"
            "    │\n"
            "    ▼\n"
            "[nvtracker (NvDCF / ByteTrack multi-object tracking & ReID)]\n"
            "    │\n"
            "    ▼\n"
            "[Custom Python/C++ Analytics Probe: Zone Polygon Containment & IEC EN 62676-4 DORI Filter]\n"
            "    │\n"
            "    ▼\n"
            "[nvmsgbroker (Kafka / RabbitMQ JSON Event Publisher @ 100ms latency)]"
        )
        p_pipe = doc.add_paragraph()
        run_pipe = p_pipe.add_run(pipeline_box)
        run_pipe.font.name = 'Consolas'
        run_pipe.font.size = Pt(9)
        run_pipe.font.color.rgb = RGBColor(0x02, 0x84, 0xC7)

        doc.add_paragraph()

        # Edge Compute & GPU Sizing Matrix Table
        add_styled_paragraph(doc, "Edge Compute & GPU Sizing Matrix", bold=True, size=12)
        gpu_rows = [
            ["Target Hardware", "NVIDIA Jetson AGX Orin 64GB or RTX 4090 24GB Server", f"Sufficient for {cam_count} concurrent 1080p@25fps real-time streams"],
            ["Decoder VRAM", f"~{cam_count * 110} MB NVMM", "110MB buffer allocated per H.265 1080p stream"],
            ["Inference VRAM", "~3,850 MB (TensorRT INT8)", "Batched TensorRT execution engine with shared weight buffers"],
            ["Total GPU Memory", f"~{cam_count * 110 + 4200} MB", "Headroom for tracking buffers, Redis frame caching, and display surfaces"],
            ["Egress Protocol", "AMQP / MQTT / Webhook JSON", "Schema compliant with Industrial IoT / SCADA event brokers"],
        ]
        add_table_with_style(doc, ["Component", "Specification", "Notes & Sizing Rationale"], gpu_rows, [1.6, 2.6, 3.2])

        doc.add_page_break()
    
    if not project.output_scope or "Detection coverage" in project.output_scope:
        # ===== 6. ZONES =====
        add_heading_styled(doc, "6. Detection Zones & Virtual Lines", 1)
        assigned_zone_count = sum(bool(zone.camera_ids) for zone in project.zones)
        coverage_percent = round(100 * assigned_zone_count / len(project.zones)) if project.zones else 0
        add_styled_paragraph(doc, f"Layout sections: {project.layout_section_count or 1} · Target detection coverage: {project.detection_coverage_target or 90}% · {coverage_percent}% of configured zones have a camera assignment. Assignment coverage is not a measured field-of-view coverage estimate.", size=10)
        if project.layout_sections:
            add_styled_paragraph(doc, "Sections: " + " · ".join(project.layout_sections), size=10)
    
        if not project.zones:
            add_styled_paragraph(doc, "No zones or lines configured. Use Camera Map to add zones.", color="#EF4444")
        else:
            zone_rows = []
            for zone in project.zones:
                zone_type = zone.type.value.replace("_", " ").title()
                zone_rows.append([
                    zone.name,
                    zone_type,
                    str(len(zone.points)),
                    str(len(zone.camera_ids)),
                    zone.color
                ])
            add_table_with_style(doc,
                ["Zone/Line", "Type", "Points", "Assigned Cameras", "Color"],
                zone_rows, [2, 1.5, 0.8, 1.5, 1.5])
        
            doc.add_paragraph()
            for zone in project.zones:
                p = doc.add_paragraph()
                run = p.add_run(f"📍 {zone.name}")
                run.bold = True
                run.font.size = Pt(11)
            
                zone_type = zone.type.value.replace("_", " ").title()
                detail_rows = [
                    ["Type", zone_type],
                    ["Points", str(len(zone.points))],
                    ["Assigned Cameras", str(len(zone.camera_ids))],
                    ["Color", zone.color],
                ]
                add_table_with_style(doc, ["Property", "Value"], detail_rows, [2, 4])
                doc.add_paragraph()
    
        doc.add_page_break()
    
    if not project.output_scope or "Workflow" in project.output_scope:
        # ===== 7. WORKFLOW =====
        add_heading_styled(doc, "7. Computer Vision Workflow", 1)
    
        if not project.workflow.nodes:
            add_styled_paragraph(doc, "No workflow generated yet. Use Workflow Editor to create one.", color="#EF4444")
        else:
            # Workflow table
            wf_rows = []
            for node in project.workflow.nodes:
                icon = NODE_ICONS.get(node.type, "⬜")
                label = node.data.get("label", node.type.value.replace("_", " ").title())
                config_items = []
                for k, v in node.data.items():
                    if k not in ["label", "category"]:
                        if isinstance(v, list):
                            config_items.append(f"{k}: {', '.join(map(str, v))}")
                        else:
                            config_items.append(f"{k}: {v}")
                wf_rows.append([
                    f"{icon} {label}",
                    node.type.value.replace("_", " ").title(),
                    "; ".join(config_items) if config_items else "—"
                ])
            add_table_with_style(doc,
                ["Node", "Type", "Configuration"],
                wf_rows, [2.5, 1.5, 4])
        
            doc.add_paragraph()
            add_styled_paragraph(doc, f"Connections: {len(project.workflow.edges)} edges", size=10, color="#64748B")
            add_styled_paragraph(doc, "The workflow represents a design-time artifact showing the proposed processing pipeline from camera input through detection, tracking, logic, and alerting.", size=10, color="#64748B")
        
            # Workflow Diagram
            if "workflow" in diagrams:
                doc.add_paragraph()
                add_styled_paragraph(doc, "Workflow Diagram", bold=True, size=12)
                try:
                    img_stream = BytesIO(diagrams["workflow"])
                    doc.add_picture(img_stream, width=Inches(6.5))
                    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                except:
                    pass
    
        doc.add_page_break()
    
    if not project.output_scope or "Assumptions & open questions" in project.output_scope:
        # ===== 8. ASSUMPTIONS =====
        add_heading_styled(doc, "8. Technical Assumptions", 1)
        if project.assumptions:
            for assumption in project.assumptions:
                p = doc.add_paragraph(style='List Bullet')
                run = p.add_run("ℹ ")
                run.font.color.rgb = RGBColor(0x3B, 0x82, 0xF6)
                run2 = p.add_run(assumption)
                run2.font.size = Pt(10)
                run2.font.name = 'Calibri'
        else:
            add_styled_paragraph(doc, "No assumptions documented.", color="#64748B")
    
        doc.add_page_break()
    
    if not project.output_scope or "Assumptions & open questions" in project.output_scope:
        # ===== 9. MISSING INFO & RISKS =====
        add_heading_styled(doc, "9. Missing Information & Risks", 1)
    
        add_styled_paragraph(doc, "Missing Information Required", bold=True, size=12, color="#F59E0B")
        if project.missing_information:
            for item in project.missing_information:
                p = doc.add_paragraph(style='List Bullet')
                run = p.add_run("⚠ ")
                run.font.color.rgb = RGBColor(0xF5, 0x9E, 0x0B)
                run2 = p.add_run(item)
                run2.font.size = Pt(10)
                run2.font.name = 'Calibri'
        else:
            add_styled_paragraph(doc, "No missing information items.", color="#10B981")
    
        doc.add_paragraph()
        add_styled_paragraph(doc, "Feasibility Risks & Mitigations", bold=True, size=12, color="#EF4444")
    
        risk_use_cases = [uc for uc in project.use_cases if uc.feasibility_status != FeasibilityStatus.FEASIBLE]
        if risk_use_cases:
            for uc in risk_use_cases:
                badge_text, badge_color = feasibility_badge(uc.feasibility_status)
                p = doc.add_paragraph()
                run = p.add_run(f"{uc.name} — ")
                run.bold = True
                run.font.size = Pt(11)
                run2 = p.add_run(badge_text)
                run2.font.color.rgb = RGBColor.from_string(badge_color.replace("#", ""))
                run2.bold = True
                run2.font.size = Pt(11)
            
                for note in uc.feasibility_notes:
                    p = doc.add_paragraph(style='List Bullet')
                    run = p.add_run(note)
                    run.font.size = Pt(10)
                    run.font.name = 'Calibri'
                    run.font.color.rgb = RGBColor(0xEF, 0x44, 0x44)
        else:
            p = doc.add_paragraph()
            run = p.add_run("✓ All use cases assessed as feasible. No major risks identified.")
            run.font.color.rgb = RGBColor(0x10, 0xB9, 0x81)
            run.font.size = Pt(11)
    
        doc.add_page_break()
    
    if not project.output_scope or "Hardware & critical components" in project.output_scope:
        # ===== 10. HARDWARE & SOFTWARE =====
        add_heading_styled(doc, "10. Suggested Hardware & Software Categories", 1)
    
        hw_items = [
            "IP cameras with 1080p+ resolution, HDR support",
            "Wide FOV (90-110°) for overview cameras",
            "IR illumination for 24/7 operation",
            "PoE+ for simplified installation",
            "ONVIF Profile S/T compliance",
            "Edge AI accelerator (NVIDIA Jetson, Google Coral, or x86 GPU)",
            "Container orchestration (Docker/Kubernetes)",
            "VMS integration (Milestone, Genetec, or open-source)",
            "Message queue (MQTT, Kafka) for event streaming",
            "Time-series database for metrics (InfluxDB, TimescaleDB)",
        ]
    
        add_styled_paragraph(doc, "Camera Hardware", bold=True, size=12)
        if project.available_hardware:
            add_styled_paragraph(doc, f"Available hardware / input feeds: {project.available_hardware}", size=10)
        if project.critical_components:
            add_styled_paragraph(doc, "Critical components", bold=True, size=12)
            add_bullet_list(doc, project.critical_components)
        for item in hw_items[:5]:
            p = doc.add_paragraph(style='List Bullet')
            run = p.add_run(item)
            run.font.size = Pt(10)
            run.font.name = 'Calibri'
    
        doc.add_paragraph()
        add_styled_paragraph(doc, "Compute & Software", bold=True, size=12)
        for item in hw_items[5:]:
            p = doc.add_paragraph(style='List Bullet')
            run = p.add_run(item)
            run.font.size = Pt(10)
            run.font.name = 'Calibri'
    
        doc.add_page_break()
    
    if not project.output_scope or "Use cases" in project.output_scope:
        # ===== 11. ACCEPTANCE CRITERIA =====
        add_heading_styled(doc, "11. Consolidated Acceptance Criteria", 1)
    
        all_criteria = []
        for uc in project.use_cases:
            for criteria in uc.acceptance_criteria:
                if criteria not in all_criteria:
                    all_criteria.append(criteria)
    
        if all_criteria:
            for i, criteria in enumerate(all_criteria, 1):
                p = doc.add_paragraph()
                run = p.add_run(f"{i}. ")
                run.bold = True
                run.font.size = Pt(10)
                run.font.color.rgb = RGBColor(0x10, 0xB9, 0x81)
                run2 = p.add_run(criteria)
                run2.font.size = Pt(10)
                run2.font.name = 'Calibri'
        else:
            add_styled_paragraph(doc, "No acceptance criteria defined yet.", color="#EF4444")
    
        doc.add_page_break()
    
    if not project.output_scope or "Implementation roadmap" in project.output_scope:
        # ===== 12. ROADMAP =====
        add_heading_styled(doc, "12. Implementation Roadmap", 1)
    
        phases = [
            ("Phase 1: Foundation (Weeks 1-4)", [
                "Procure and install cameras per layout",
                "Configure network, VLANs, and VMS integration",
                "Establish baseline lighting and environmental conditions",
                "Deploy edge compute infrastructure",
            ], "#3B82F6"),
            ("Phase 2: Model Development (Weeks 5-10)", [
                "Collect and annotate training data from camera feeds",
                "Train/finetune detection models per use case",
                "Validate model performance against acceptance criteria",
                "Implement tracking and logic modules",
            ], "#10B981"),
            ("Phase 3: Integration & Testing (Weeks 11-16)", [
                "End-to-end pipeline integration",
                "Alert routing and notification configuration",
                "User acceptance testing with stakeholders",
                "Performance optimization and tuning",
            ], "#F59E0B"),
            ("Phase 4: Deployment & Operations (Weeks 17-20)", [
                "Production rollout with monitoring",
                "Documentation and runbook creation",
                "Staff training and handover",
                "Ongoing model retraining schedule",
            ], "#8B5CF6"),
        ]
    
        for phase_name, tasks, color in phases:
            add_styled_paragraph(doc, phase_name, bold=True, size=12, color=color)
            for task in tasks:
                p = doc.add_paragraph(style='List Bullet')
                run = p.add_run(task)
                run.font.size = Pt(10)
                run.font.name = 'Calibri'
            doc.add_paragraph()
    
        # Gantt Chart
        if "gantt" in diagrams:
            doc.add_paragraph()
            add_styled_paragraph(doc, "Roadmap Gantt Chart", bold=True, size=12)
            try:
                img_stream = BytesIO(diagrams["gantt"])
                doc.add_picture(img_stream, width=Inches(6.5))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            except:
                pass
    
        doc.add_page_break()
    
    # ===== APPENDIX =====
    add_heading_styled(doc, "Appendix A: Project JSON Export", 1)
    add_styled_paragraph(doc, "The complete project configuration is available as a JSON export for programmatic access and version control.", size=10, color="#64748B")
    
    # Footer
    doc.add_paragraph()
    footer = doc.add_paragraph()
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("TechHub Plan Vision — Computer Vision Planning")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
    run.font.name = 'Calibri'
    
    footer2 = doc.add_paragraph()
    footer2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer2.add_run("Generated from the TechHub Plan Vision project configuration.")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
    run.font.name = 'Calibri'
    
    # Save to bytes
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def format_date(date_str: str) -> str:
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return dt.strftime("%B %d, %Y")
    except:
        return date_str


def get_docx_filename(project: DetVisionProject) -> str:
    safe_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in project.name)
    return f"{safe_name}-plan-vision-blueprint.docx"
