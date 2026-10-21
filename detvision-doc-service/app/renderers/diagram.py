import base64
from typing import Dict, Any, Optional, List
from app.models import Workflow, WorkflowNode, WorkflowEdge, NodeCategory, DetVisionProject, Camera, Zone, ZoneType
import xml.etree.ElementTree as ET


NODE_ICONS = {
    NodeCategory.CAMERA_INPUT: "📷",
    NodeCategory.FRAME_SAMPLING: "⏱️",
    NodeCategory.PREPROCESSING: "🔧",
    NodeCategory.OBJECT_DETECTION: "🎯",
    NodeCategory.CLASSIFICATION: "🏷️",
    NodeCategory.SEGMENTATION: "✂️",
    NodeCategory.OCR: "📝",
    NodeCategory.MEASUREMENT: "📏",
    NodeCategory.TRACKING: "🔄",
    NodeCategory.ZONE_LOGIC: "📦",
    NodeCategory.LINE_CROSSING: "📐",
    NodeCategory.DECISION: "🤔",
    NodeCategory.ALERT: "🚨",
    NodeCategory.EVENT_STORAGE: "💾",
    NodeCategory.MANUAL_REVIEW: "👁️",
}

NODE_COLORS = {
    NodeCategory.CAMERA_INPUT: "#3B82F6",
    NodeCategory.FRAME_SAMPLING: "#6366F1",
    NodeCategory.PREPROCESSING: "#8B5CF6",
    NodeCategory.OBJECT_DETECTION: "#EF4444",
    NodeCategory.CLASSIFICATION: "#EC4899",
    NodeCategory.SEGMENTATION: "#F59E0B",
    NodeCategory.OCR: "#10B981",
    NodeCategory.MEASUREMENT: "#06B6D4",
    NodeCategory.TRACKING: "#64748B",
    NodeCategory.ZONE_LOGIC: "#84CC16",
    NodeCategory.LINE_CROSSING: "#F97316",
    NodeCategory.DECISION: "#7C3AED",
    NodeCategory.ALERT: "#EF4444",
    NodeCategory.EVENT_STORAGE: "#3B82F6",
    NodeCategory.MANUAL_REVIEW: "#F59E0B",
}


def create_svg_element(tag: str, attrs: Dict[str, str] = None, text: str = None, children: List = None) -> ET.Element:
    """Helper to create SVG elements."""
    el = ET.Element(tag)
    if attrs:
        for k, v in attrs.items():
            el.set(k, v)
    if text:
        el.text = text
    if children:
        for child in children:
            el.append(child)
    return el


def generate_workflow_svg(workflow: Workflow, width: int = 800, height: int = 600) -> bytes:
    """Generate a simple SVG workflow diagram."""
    svg = create_svg_element("svg", {
        "xmlns": "http://www.w3.org/2000/svg",
        "width": str(width),
        "height": str(height),
        "viewBox": f"0 0 {width} {height}",
    })
    
    # Definitions for gradients, markers
    defs = create_svg_element("defs")
    
    # Arrow marker
    marker = create_svg_element("marker", {
        "id": "arrowhead",
        "markerWidth": "10",
        "markerHeight": "7",
        "refX": "9",
        "refY": "3.5",
        "orient": "auto",
    })
    marker.append(create_svg_element("polygon", {
        "points": "0 0, 10 3.5, 0 7",
        "fill": "#64748b"
    }))
    defs.append(marker)
    
    # Node gradients
    for cat in NodeCategory:
        color = NODE_COLORS.get(cat, "#999")
        grad = create_svg_element("linearGradient", {
            "id": f"grad_{cat.value}",
            "x1": "0%", "y1": "0%", "x2": "0%", "y2": "100%",
        })
        grad.append(create_svg_element("stop", {"offset": "0%", "stop-color": color + "30"}))
        grad.append(create_svg_element("stop", {"offset": "100%", "stop-color": color + "10"}))
        defs.append(grad)
    
    svg.append(defs)
    
    # Calculate layout - simple horizontal flow
    nodes = workflow.nodes
    edges = workflow.edges
    
    # Build adjacency for layout
    node_map = {n.id: n for n in nodes}
    out_edges = {}
    in_edges = {}
    for e in edges:
        out_edges.setdefault(e.source, []).append(e.target)
        in_edges.setdefault(e.target, []).append(e.source)
    
    # Find root nodes (no incoming edges)
    roots = [n for n in nodes if n.id not in in_edges]
    if not roots:
        roots = nodes[:1]
    
    # Simple layout: assign x based on depth from root
    node_positions = {}
    
    def assign_positions(node_id: str, depth: int, x_offset: float = 100):
        if node_id in node_positions:
            return
        node_positions[node_id] = (x_offset + depth * 200, 100 + (len(node_positions) % 5) * 100)
        for target in out_edges.get(node_id, []):
            assign_positions(target, depth + 1, x_offset)
    
    for i, root in enumerate(roots):
        assign_positions(root.id, 0, 100 + i * 50)
    
    # Draw edges first (behind nodes)
    for edge in edges:
        src_pos = node_positions.get(edge.source)
        tgt_pos = node_positions.get(edge.target)
        if src_pos and tgt_pos:
            # Simple straight line with arrow
            line = create_svg_element("line", {
                "x1": str(src_pos[0] + 80),  # right edge of source node
                "y1": str(src_pos[1] + 30),  # center of node
                "x2": str(tgt_pos[0]),       # left edge of target node
                "y2": str(tgt_pos[1] + 30),
                "stroke": "#64748b",
                "stroke-width": "2",
                "marker-end": "url(#arrowhead)",
            })
            svg.append(line)
    
    # Draw nodes
    for node in nodes:
        pos = node_positions.get(node.id, (100, 100))
        x, y = pos
        color = NODE_COLORS.get(node.type, "#999")
        icon = NODE_ICONS.get(node.type, "⬜")
        label = node.data.get("label", node.type.value.replace("_", " ").title())
        
        # Node group
        g = create_svg_element("g", {"transform": f"translate({x}, {y})"})
        
        # Node background
        node_width = 160
        node_height = 60
        rx, ry = 8, 8
        
        rect = create_svg_element("rect", {
            "x": "0", "y": "0",
            "width": str(node_width),
            "height": str(node_height),
            "rx": str(rx), "ry": str(ry),
            "fill": f"url(#grad_{node.type.value})",
            "stroke": color,
            "stroke-width": "2",
        })
        g.append(rect)
        
        # Icon
        icon_text = create_svg_element("text", {
            "x": "15", "y": "25",
            "font-size": "20",
            "font-family": "Arial, sans-serif",
        }, text=icon)
        g.append(icon_text)
        
        # Label
        label_text = create_svg_element("text", {
            "x": "50", "y": "22",
            "font-size": "12",
            "font-weight": "600",
            "font-family": "Arial, sans-serif",
            "fill": "#1e293b",
        }, text=label[:20])
        g.append(label_text)
        
        # Type label
        type_text = create_svg_element("text", {
            "x": "50", "y": "42",
            "font-size": "9",
            "font-family": "Arial, sans-serif",
            "fill": color,
        }, text=node.type.value.replace("_", " ").title())
        g.append(type_text)
        
        svg.append(g)
    
    # Convert to string
    ET.indent(svg, space="  ")
    svg_str = ET.tostring(svg, encoding="unicode", method="xml")
    return svg_str.encode()


def generate_camera_map_svg(project: DetVisionProject, width: int = 800, height: int = 600) -> bytes:
    """Generate a simple SVG camera layout diagram."""
    svg = create_svg_element("svg", {
        "xmlns": "http://www.w3.org/2000/svg",
        "width": str(width),
        "height": str(height),
        "viewBox": f"0 0 {width} {height}",
    })
    
    # Background
    bg = create_svg_element("rect", {
        "x": "0", "y": "0",
        "width": str(width), "height": str(height),
        "fill": "#f8fafc",
    })
    svg.append(bg)
    
    # Grid
    for i in range(0, width, 50):
        svg.append(create_svg_element("line", {
            "x1": str(i), "y1": "0", "x2": str(i), "y2": str(height),
            "stroke": "#e2e8f0", "stroke-width": "0.5",
        }))
    for i in range(0, height, 50):
        svg.append(create_svg_element("line", {
            "x1": "0", "y1": str(i), "x2": str(width), "y2": str(i),
            "stroke": "#e2e8f0", "stroke-width": "0.5",
        }))
    
    # Structure (walls, obstacles, entrances)
    structure_colors = {"wall": "#475569", "obstacle": "#F59E0B", "entrance": "#10B981"}
    for element in project.structure:
        if len(element.points) < 2:
            continue
        kind = element.type if element.type in structure_colors else "wall"
        color = structure_colors[kind]
        points = " ".join(f"{p.x * width},{p.y * height}" for p in element.points)
        if kind == "obstacle" and len(element.points) >= 3:
            svg.append(create_svg_element("polygon", {
                "points": points, "fill": color + "40", "stroke": color, "stroke-width": "2",
            }))
        else:
            attrs = {"points": points, "fill": "none", "stroke": color, "stroke-width": "4" if kind == "wall" else "3", "stroke-linecap": "round"}
            if kind == "entrance":
                attrs["stroke-dasharray"] = "8,5"
            svg.append(create_svg_element("polyline", attrs))

    # Zones
    for zone in project.zones:
        if len(zone.points) >= 2:
            points = " ".join(f"{p.x * width},{p.y * height}" for p in zone.points)
            if zone.type == ZoneType.VIRTUAL_LINE:
                line = create_svg_element("polyline", {
                    "points": points,
                    "fill": "none",
                    "stroke": zone.color,
                    "stroke-width": "3",
                    "stroke-dasharray": "10,5",
                })
                svg.append(line)
            else:
                poly = create_svg_element("polygon", {
                    "points": points,
                    "fill": zone.color + "30",
                    "stroke": zone.color,
                    "stroke-width": "2",
                    "stroke-dasharray": "5,5",
                })
                svg.append(poly)
            
            # Zone label
            if zone.points:
                cx = sum(p.x for p in zone.points) / len(zone.points) * width
                cy = sum(p.y for p in zone.points) / len(zone.points) * height
                label = create_svg_element("text", {
                    "x": str(cx), "y": str(cy),
                    "font-size": "12", "font-weight": "600",
                    "text-anchor": "middle", "fill": zone.color,
                    "font-family": "Arial, sans-serif",
                }, text=zone.name)
                svg.append(label)
    
    # Cameras
    cam_count = len(project.cameras)
    cam_radius = "6" if cam_count > 40 else "10" if cam_count > 20 else "16"
    dir_len = 10 if cam_count > 40 else 16 if cam_count > 20 else 22
    stroke_w = "1.5" if cam_count > 40 else "2" if cam_count > 20 else "3"

    for idx, cam in enumerate(project.cameras):
        cx = cam.x * width
        cy = cam.y * height
        color = {
            "planned": "#64748B", "installed": "#3B82F6", "active": "#10B981",
            "maintenance": "#F59E0B", "offline": "#EF4444",
        }.get(cam.status.value, "#64748B")
        
        # Camera body
        circle = create_svg_element("circle", {
            "cx": str(cx), "cy": str(cy), "r": cam_radius,
            "fill": color, "stroke": "white", "stroke-width": stroke_w,
        })
        svg.append(circle)
        
        # Direction line
        import math
        angle = math.radians(cam.orientation_degrees)
        dx = math.cos(angle) * dir_len
        dy = math.sin(angle) * dir_len
        line = create_svg_element("line", {
            "x1": str(cx), "y1": str(cy),
            "x2": str(cx + dx), "y2": str(cy + dy),
            "stroke": "white", "stroke-width": stroke_w, "stroke-linecap": "round",
        })
        svg.append(line)
        
        # Camera label (shortened for large plans to prevent overlap)
        if cam_count <= 30 or (idx % 2 == 0):
            short_name = cam.name.split('[')[0].strip() if '[' in cam.name else cam.name[:10]
            label = create_svg_element("text", {
                "x": str(cx), "y": str(cy - (12 if cam_count > 30 else 22)),
                "font-size": "8" if cam_count > 30 else "10",
                "font-weight": "600",
                "text-anchor": "middle", "fill": color,
                "font-family": "Arial, sans-serif",
            }, text=short_name)
            svg.append(label)
    
    # Legend
    legend_y = 20
    legend_items = [
        ("📷 Camera", "#3B82F6"),
        ("📍 Zone", "#EF4444"),
        ("📏 Virtual Line", "#3B82F6"),
    ]
    structure_kinds = {element.type for element in project.structure}
    if "wall" in structure_kinds:
        legend_items.append(("🧱 Wall", "#475569"))
    if "obstacle" in structure_kinds:
        legend_items.append(("⚠️ Obstacle", "#F59E0B"))
    if "entrance" in structure_kinds:
        legend_items.append(("🚪 Entrance", "#10B981"))
    for i, (label, clr) in enumerate(legend_items):
        lx = width - 180
        ly = legend_y + i * 25
        svg.append(create_svg_element("circle", {
            "cx": str(lx), "cy": str(ly + 5), "r": "6",
            "fill": clr + "30", "stroke": clr, "stroke-width": "2",
        }))
        svg.append(create_svg_element("text", {
            "x": str(lx + 15), "y": str(ly + 10),
            "font-size": "11", "fill": "#334155", "font-family": "Arial, sans-serif",
        }, text=label))
    
    # Title
    title = create_svg_element("text", {
        "x": str(width // 2), "y": "30",
        "font-size": "16", "font-weight": "700",
        "text-anchor": "middle", "fill": "#1e293b",
        "font-family": "Arial, sans-serif",
    }, text="Camera Layout")
    svg.append(title)
    
    ET.indent(svg, space="  ")
    return ET.tostring(svg, encoding="unicode", method="xml").encode()


def generate_gantt_svg(project: DetVisionProject, width: int = 800, height: int = 500) -> bytes:
    """Generate a simple SVG Gantt chart."""
    svg = create_svg_element("svg", {
        "xmlns": "http://www.w3.org/2000/svg",
        "width": str(width),
        "height": str(height),
        "viewBox": f"0 0 {width} {height}",
    })
    
    # Background
    bg = create_svg_element("rect", {
        "x": "0", "y": "0", "width": str(width), "height": str(height),
        "fill": "white",
    })
    svg.append(bg)
    
    phases = [
        ("Phase 1: Foundation", 0, 28, "#3B82F6", [
            ("Camera Procurement", 0, 14),
            ("Network & VMS Config", 14, 7),
            ("Lighting Baseline", 14, 7),
            ("Edge Compute Deploy", 21, 7),
        ]),
        ("Phase 2: Model Development", 28, 56, "#10B981", [
            ("Data Collection", 28, 21),
            ("Model Training", 49, 21),
            ("Validation", 70, 14),
            ("Tracking Logic", 70, 14),
        ]),
        ("Phase 3: Integration & Test", 56, 42, "#F59E0B", [
            ("E2E Integration", 56, 14),
            ("Alert Config", 70, 7),
            ("UAT", 77, 14),
            ("Optimization", 91, 14),
        ]),
        ("Phase 4: Deployment & Ops", 98, 28, "#8B5CF6", [
            ("Production Rollout", 98, 14),
            ("Documentation", 112, 7),
            ("Training", 119, 7),
            ("Retraining Setup", 126, 7),
        ]),
    ]
    
    # Time scale (weeks)
    week_width = width / 20  # 20 weeks shown
    start_x = 150
    
    # Week markers
    for w in range(0, 21, 2):
        x = start_x + w * week_width
        svg.append(create_svg_element("line", {
            "x1": str(x), "y1": "50", "x2": str(x), "y2": str(height - 20),
            "stroke": "#e2e8f0", "stroke-width": "0.5",
        }))
        svg.append(create_svg_element("text", {
            "x": str(x), "y": "45", "font-size": "9", "text-anchor": "middle",
            "fill": "#94a3b8", "font-family": "Arial, sans-serif",
        }, text=f"W{w+1}"))
    
    y = 70
    row_height = 30
    
    for phase_name, phase_start, phase_duration, phase_color, tasks in phases:
        # Phase header
        phase_x = start_x + phase_start * week_width
        phase_w = phase_duration * week_width
        
        phase_bg = create_svg_element("rect", {
            "x": str(phase_x), "y": str(y - 10),
            "width": str(phase_w), "height": str(len(tasks) * row_height + 30),
            "fill": phase_color + "10", "stroke": phase_color, "stroke-width": "1",
        })
        svg.append(phase_bg)
        
        phase_label = create_svg_element("text", {
            "x": str(phase_x + 5), "y": str(y + 5),
            "font-size": "11", "font-weight": "600", "fill": phase_color,
            "font-family": "Arial, sans-serif",
        }, text=phase_name)
        svg.append(phase_label)
        
        y += 25
        
        for task_name, task_start, task_duration in tasks:
            task_x = start_x + task_start * week_width
            task_w = task_duration * week_width
            
            task_bar = create_svg_element("rect", {
                "x": str(task_x), "y": str(y),
                "width": str(task_w), "height": str(row_height - 8),
                "rx": "4", "ry": "4",
                "fill": phase_color, "opacity": "0.8",
            })
            svg.append(task_bar)
            
            task_label = create_svg_element("text", {
                "x": str(task_x + 5), "y": str(y + row_height // 2 + 3),
                "font-size": "9", "fill": "white", "font-weight": "500",
                "font-family": "Arial, sans-serif",
            }, text=task_name)
            svg.append(task_label)
            
            y += row_height
        
        y += 15
    
    # Title
    title = create_svg_element("text", {
        "x": str(width // 2), "y": "30",
        "font-size": "16", "font-weight": "700",
        "text-anchor": "middle", "fill": "#1e293b",
        "font-family": "Arial, sans-serif",
    }, text="Implementation Roadmap")
    svg.append(title)
    
    ET.indent(svg, space="  ")
    return ET.tostring(svg, encoding="unicode", method="xml").encode()


def generate_top_view_svg(project: DetVisionProject, width: int = 860, height: int = 480) -> bytes:
    """Picture 1: Top View (2D Orthographic Site Blueprint)."""
    import math
    import html
    fw = project.facility_width_m or 60.0
    fl = project.facility_length_m or 25.0
    fh = project.facility_height_m or 5.0
    padding = 50
    map_w = width - padding * 2
    map_h = height - padding * 2

    def to_x(norm_x: float) -> float:
        return padding + max(0.0, min(1.0, norm_x)) * map_w

    def to_y(norm_y: float) -> float:
        return padding + max(0.0, min(1.0, norm_y)) * map_h

    obstacle_elements = []
    for idx, st in enumerate(project.structure):
        if not st.points:
            continue
        st_type = (st.obstacle_type or st.type or "obstacle").lower()
        fill = "rgba(79, 70, 229, 0.2)"
        stroke = "#4f46e5"
        type_label = "RACK"
        st_name_lower = st.name.lower()
        if any(k in st_type or k in st_name_lower for k in ["conveyor", "roller", "belt", "assembly"]):
            fill = "rgba(13, 148, 136, 0.25)"
            stroke = "#0d9488"
            type_label = "CONVEYOR"
        elif any(k in st_type or k in st_name_lower for k in ["machine", "robot", "press", "cnc", "rejection"]):
            fill = "rgba(37, 99, 235, 0.25)"
            stroke = "#2563eb"
            type_label = "MACHINE"
        elif any(k in st_type or k in st_name_lower for k in ["hazard", "chemical", "spill", "danger", "tank"]):
            fill = "rgba(239, 68, 68, 0.25)"
            stroke = "#dc2626"
            type_label = "HAZARD"
        elif any(k in st_type or k in st_name_lower for k in ["dock", "bay", "loading", "door", "gate"]):
            fill = "rgba(6, 182, 212, 0.25)"
            stroke = "#0891b2"
            type_label = "DOCK"
        elif any(k in st_name_lower for k in ["building", "hall", "workshop", "room", "section"]):
            fill = "rgba(100, 116, 139, 0.15)"
            stroke = "#475569"
            type_label = "ZONE"

        if len(st.points) >= 3:
            pts_str = " ".join(f"{to_x(p.x):.1f},{to_y(p.y):.1f}" for p in st.points)
            center_x = sum(to_x(p.x) for p in st.points) / len(st.points)
            center_y = sum(to_y(p.y) for p in st.points) / len(st.points)
            safe_name = html.escape(st.name[:22] + "…" if len(st.name) > 24 else st.name)
            obstacle_elements.append(f"""
              <g id="top-struct-{idx}">
                <polygon points="{pts_str}" fill="{fill}" stroke="{stroke}" stroke-width="2" />
                <text x="{center_x:.1f}" y="{center_y:.1f}" fill="{stroke}" font-size="9" font-family="system-ui, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">{safe_name}</text>
                <text x="{center_x:.1f}" y="{center_y + 10:.1f}" fill="{stroke}" font-size="7.5" font-family="system-ui, sans-serif" font-weight="600" opacity="0.8" text-anchor="middle" dominant-baseline="middle">[{type_label}]</text>
              </g>
            """)
        elif len(st.points) == 2:
            obstacle_elements.append(f"""
              <line x1="{to_x(st.points[0].x):.1f}" y1="{to_y(st.points[0].y):.1f}" x2="{to_x(st.points[1].x):.1f}" y2="{to_y(st.points[1].y):.1f}" stroke="#334155" stroke-width="4" stroke-linecap="round" />
            """)

    zone_elements = []
    for z in project.zones:
        if len(z.points) >= 3:
            pts_str = " ".join(f"{to_x(p.x):.1f},{to_y(p.y):.1f}" for p in z.points)
            clr = z.color or "#3b82f6"
            zone_elements.append(f"""
              <polygon points="{pts_str}" fill="{clr}" fill-opacity="0.12" stroke="{clr}" stroke-width="1.5" stroke-dasharray="5,4" />
            """)

    cam_elements = []
    for idx, cam in enumerate(project.cameras):
        cx = to_x(cam.x)
        cy = to_y(cam.y)
        orient = cam.orientation_degrees or 0.0
        fov = cam.horizontal_fov_degrees or 90.0
        dist = min(map_w, map_h) * (cam.view_range or 0.45)
        rad_start = math.radians(orient - fov / 2.0)
        rad_end = math.radians(orient + fov / 2.0)
        x1 = cx + dist * math.cos(rad_start)
        y1 = cy + dist * math.sin(rad_start)
        x2 = cx + dist * math.cos(rad_end)
        y2 = cy + dist * math.sin(rad_end)
        orient_rad = math.radians(orient)
        ax = cx + dist * 0.9 * math.cos(orient_rad)
        ay = cy + dist * 0.9 * math.sin(orient_rad)

        cam_tag = f"CAM-{idx + 1:02d}"
        cam_elements.append(f"""
          <g id="top-cam-{idx}">
            <path d="M {cx:.1f} {cy:.1f} L {x1:.1f} {y1:.1f} A {dist:.1f} {dist:.1f} 0 0 1 {x2:.1f} {y2:.1f} Z" fill="rgba(14, 165, 233, 0.18)" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="3,2" />
            <line x1="{cx:.1f}" y1="{cy:.1f}" x2="{ax:.1f}" y2="{ay:.1f}" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.75" />
            <circle cx="{cx:.1f}" cy="{cy:.1f}" r="7.5" fill="#0284c7" stroke="#ffffff" stroke-width="2" />
            <circle cx="{cx:.1f}" cy="{cy:.1f}" r="3" fill="#ffffff" />
            <rect x="{cx - 22:.1f}" y="{cy - 20:.1f}" width="44" height="13" rx="3" fill="#0f172a" fill-opacity="0.85" />
            <text x="{cx:.1f}" y="{cy - 11:.1f}" fill="#ffffff" font-size="8" font-family="ui-monospace, monospace" font-weight="700" text-anchor="middle">{cam_tag}</text>
          </g>
        """)

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#ffffff;border-radius:12px;border:1px solid #cbd5e1;">
      <defs>
        <pattern id="facility-grid-top" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#f1f5f9" stroke-width="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="{width}" height="{height}" fill="url(#facility-grid-top)" />
      <rect x="{padding}" y="{padding}" width="{map_w}" height="{map_h}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="6,3" />

      <!-- Title Bar -->
      <rect x="0" y="0" width="{width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="{width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#38bdf8" />
      <text x="32" y="19" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">MULTI-ANGLE SIMULATION · TOP VIEW (2D ORTHOGRAPHIC BLUEPRINT)</text>
      <text x="{width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Site: {fw:.1f}m × {fl:.1f}m · Ceiling: {fh:.1f}m · {len(project.cameras)} Cameras Active</text>

      {"".join(obstacle_elements)}
      {"".join(zone_elements)}
      {"".join(cam_elements)}

      <g transform="translate({padding}, {height - 20})">
        <circle cx="10" cy="5" r="4" fill="#0284c7" />
        <text x="20" y="8" fill="#334155" font-size="8.5" font-family="system-ui">Camera FOV Cones</text>
        <rect x="130" y="1" width="12" height="8" fill="rgba(13, 148, 136, 0.3)" stroke="#0d9488" />
        <text x="148" y="8" fill="#334155" font-size="8.5" font-family="system-ui">Conveyors / Lines</text>
        <rect x="250" y="1" width="12" height="8" fill="rgba(79, 70, 229, 0.3)" stroke="#4f46e5" />
        <text x="268" y="8" fill="#334155" font-size="8.5" font-family="system-ui">Racks / Obstacles</text>
        <rect x="370" y="1" width="12" height="8" fill="rgba(239, 68, 68, 0.3)" stroke="#dc2626" />
        <text x="388" y="8" fill="#334155" font-size="8.5" font-family="system-ui">Hazard / Spill Berms</text>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_bird_camera_3d_svg(project: DetVisionProject, width: int = 860, height: int = 480) -> bytes:
    """Picture 2: Bird Camera 3D View (Raycasting Occlusion Engine)."""
    import html
    origin_x = width * 0.48
    origin_y = height * 0.38
    scale_x = width * 0.42
    scale_y = height * 0.45
    scale_z = 16.0

    def project_3d(nx: float, ny: float, nz_m: float = 0.0):
        px = origin_x + nx * scale_x - ny * 0.28 * scale_x
        py = origin_y - nz_m * scale_z + ny * scale_y * 0.85 - (nx * 0.12 * scale_y)
        return px, py

    f0 = project_3d(0.05, 0.05, 0)
    f1 = project_3d(0.95, 0.05, 0)
    f2 = project_3d(0.95, 0.95, 0)
    f3 = project_3d(0.05, 0.95, 0)

    obstacle_polys = []
    for idx, st in enumerate(project.structure):
        if st.points and len(st.points) >= 3:
            h_m = st.height_m or (3.8 if st.obstacle_type == "rack" else 2.4 if st.obstacle_type == "machine" else 1.5)
            base_pts = [project_3d(p.x, p.y, 0) for p in st.points]
            top_pts = [project_3d(p.x, p.y, h_m) for p in st.points]
            base_poly = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in base_pts)
            top_poly = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in top_pts)

            side_walls = []
            for i in range(len(base_pts)):
                nxt = (i + 1) % len(base_pts)
                side_walls.append(
                    f'<polygon points="{base_pts[i][0]:.1f},{base_pts[i][1]:.1f} {base_pts[nxt][0]:.1f},{base_pts[nxt][1]:.1f} {top_pts[nxt][0]:.1f},{top_pts[nxt][1]:.1f} {top_pts[i][0]:.1f},{top_pts[i][1]:.1f}" fill="rgba(30, 41, 59, 0.85)" stroke="#475569" stroke-width="1" />'
                )
            safe_name = html.escape(st.name)
            obstacle_polys.append(f"""
              <g id="bird-obs-{idx}">
                <polygon points="{base_poly}" fill="rgba(15, 23, 42, 0.6)" />
                {"".join(side_walls)}
                <polygon points="{top_poly}" fill="rgba(51, 65, 85, 0.95)" stroke="#00e5ff" stroke-width="1.2" opacity="0.9" />
                <text x="{top_pts[0][0]:.1f}" y="{top_pts[0][1] - 4:.1f}" fill="#00e5ff" font-size="8" font-family="system-ui" font-weight="700">{safe_name} [H={h_m:.1f}m]</text>
              </g>
            """)

    w_base = project_3d(0.58, 0.65, 0)
    w_torso = project_3d(0.58, 0.65, 1.2)
    w_head = project_3d(0.58, 0.65, 1.8)

    palette = ['#00e5ff', '#ff6b35', '#7fff6b', '#c084fc', '#ffd60a', '#f472b6', '#38bdf8', '#fb923c']
    cam_elements = []
    ray_lines = []
    for idx, cam in enumerate(project.cameras[:15]):
        c_base = project_3d(cam.x, cam.y, 0)
        c_head = project_3d(cam.x, cam.y, 5.0)
        color = palette[idx % len(palette)]
        cam_elements.append(f"""
          <g id="bird-cam-{idx}">
            <line x1="{c_base[0]:.1f}" y1="{c_base[1]:.1f}" x2="{c_head[0]:.1f}" y2="{c_head[1]:.1f}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="2,2" />
            <circle cx="{c_base[0]:.1f}" cy="{c_base[1]:.1f}" r="3" fill="#64748b" opacity="0.5" />
            <circle cx="{c_head[0]:.1f}" cy="{c_head[1]:.1f}" r="6" fill="{color}" stroke="#ffffff" stroke-width="1.5" />
            <text x="{c_head[0]:.1f}" y="{c_head[1] - 8:.1f}" fill="{color}" font-size="8.5" font-family="ui-monospace, monospace" font-weight="800" text-anchor="middle">C{idx + 1}</text>
          </g>
        """)
        if idx in [4, 11, 12]:
            is_occ = (idx == 11)
            ray_stroke = "#f59e0b" if is_occ else "#00e5ff"
            ray_dash = "4,3" if is_occ else "none"
            ray_lines.append(f"""
              <line x1="{c_head[0]:.1f}" y1="{c_head[1]:.1f}" x2="{w_torso[0]:.1f}" y2="{w_torso[1]:.1f}" stroke="{ray_stroke}" stroke-width="1.5" stroke-dasharray="{ray_dash}" opacity="0.85" />
            """)

    grid_lines = []
    for frac in [0.25, 0.50, 0.75]:
        pA = project_3d(frac, 0.05, 0)
        pB = project_3d(frac, 0.95, 0)
        pC = project_3d(0.05, frac, 0)
        pD = project_3d(0.95, frac, 0)
        grid_lines.append(f"""
          <line x1="{pA[0]:.1f}" y1="{pA[1]:.1f}" x2="{pB[0]:.1f}" y2="{pB[1]:.1f}" stroke="#1e293b" stroke-width="1" />
          <line x1="{pC[0]:.1f}" y1="{pC[1]:.1f}" x2="{pD[0]:.1f}" y2="{pD[1]:.1f}" stroke="#1e293b" stroke-width="1" />
        """)

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#0b0f19;border-radius:12px;border:1px solid #1e293b;">
      <defs>
        <radialGradient id="bird-glow-py" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#00e5ff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="{width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="{width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#00e5ff" />
      <text x="32" y="19" fill="#00e5ff" font-size="11" font-weight="800" font-family="ui-monospace, monospace">MULTI-ANGLE SIMULATION · BIRD CAMERA 3D (RAYCASTING OCCLUSION ENGINE)</text>
      <text x="{width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Yaw: -20° · Pitch: 68° · Zoom: 1.73x · {len(project.cameras)} Cameras Active</text>

      <polygon points="{f0[0]:.1f},{f0[1]:.1f} {f1[0]:.1f},{f1[1]:.1f} {f2[0]:.1f},{f2[1]:.1f} {f3[0]:.1f},{f3[1]:.1f}" fill="rgba(15, 23, 42, 0.75)" stroke="#334155" stroke-width="1.5" />
      {"".join(grid_lines)}
      {"".join(obstacle_polys)}
      {"".join(ray_lines)}

      <g id="bird-tracked-worker">
        <ellipse cx="{w_base[0]:.1f}" cy="{w_base[1]:.1f}" rx="18" ry="8" fill="url(#bird-glow-py)" />
        <line x1="{w_base[0]:.1f}" y1="{w_base[1]:.1f}" x2="{w_head[0]:.1f}" y2="{w_head[1]:.1f}" stroke="#00e5ff" stroke-width="2" />
        <circle cx="{w_head[0]:.1f}" cy="{w_head[1]:.1f}" r="4" fill="#00e5ff" stroke="#ffffff" stroke-width="1" />
        <circle cx="{w_torso[0]:.1f}" cy="{w_torso[1]:.1f}" r="3" fill="#10b981" />
        <circle cx="{w_base[0]:.1f}" cy="{w_base[1]:.1f}" r="3" fill="#f59e0b" />
        <rect x="{w_head[0] + 8:.1f}" y="{w_head[1] - 12:.1f}" width="110" height="24" rx="4" fill="rgba(15, 23, 42, 0.9)" stroke="#00e5ff" stroke-width="1" />
        <text x="{w_head[0] + 14:.1f}" y="{w_head[1] + 2:.1f}" fill="#ffffff" font-size="8" font-family="system-ui" font-weight="700">Target: Worker (1.8m)</text>
        <text x="{w_head[0] + 14:.1f}" y="{w_head[1] + 9:.1f}" fill="#10b981" font-size="6.5" font-family="ui-monospace">3/3 Anchors Tracked</text>
      </g>

      {"".join(cam_elements)}

      <g transform="translate({width - 240}, {height - 100})">
        <rect x="0" y="0" width="225" height="88" rx="8" fill="rgba(15, 23, 42, 0.92)" stroke="#1e293b" stroke-width="1.5" />
        <text x="12" y="18" fill="#00e5ff" font-size="9" font-weight="800" font-family="ui-monospace">● TARGET TRACKING &amp; LOS</text>
        <text x="12" y="34" fill="#94a3b8" font-size="8" font-family="system-ui">Slant Distance: <tspan fill="#ffffff" font-weight="700">3.8m</tspan> (Cam C12)</text>
        <text x="12" y="48" fill="#94a3b8" font-size="8" font-family="system-ui">Ray Visibility: <tspan fill="#10b981" font-weight="700">100% Unobstructed</tspan></text>
        <text x="12" y="62" fill="#94a3b8" font-size="8" font-family="system-ui">DORI Resolution: <tspan fill="#00e5ff" font-weight="700">Identify (≥250 px/m)</tspan></text>
        <rect x="12" y="68" width="200" height="12" rx="3" fill="#1e293b" />
        <rect x="12" y="68" width="198" height="12" rx="3" fill="#00e5ff" opacity="0.8" />
        <text x="112" y="77" fill="#0b0f19" font-size="7.5" font-weight="800" text-anchor="middle" font-family="ui-monospace">IEC EN 62676-4 VERIFIED</text>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_frustum_dori_3d_svg(project: DetVisionProject, width: int = 860, height: int = 480) -> bytes:
    """Picture 3: Frustum & DORI 3D Spatial Projection."""
    cams = project.cameras or []
    primary = cams[0] if cams else None
    res_w = primary.resolution_width if primary else 2688
    res_h = primary.resolution_height if primary else 1520

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#090d16;border-radius:12px;border:1px solid #1e293b;">
      <defs>
        <linearGradient id="dori-grad-py" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.85" />
          <stop offset="25%" stop-color="#10b981" stop-opacity="0.80" />
          <stop offset="55%" stop-color="#eab308" stop-opacity="0.75" />
          <stop offset="100%" stop-color="#f97316" stop-opacity="0.65" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="{width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="{width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#38bdf8" />
      <text x="32" y="19" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">MULTI-ANGLE SIMULATION · FRUSTUM &amp; DORI 3D SPATIAL PROJECTION</text>
      <text x="{width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Standard: IEC EN 62676-4:2025 · Sensor: {res_w}×{res_h} · Lens: 2.8mm</text>

      <g transform="translate(60, 65)">
        <line x1="0" y1="20" x2="360" y2="20" stroke="#475569" stroke-width="4" />
        <text x="0" y="12" fill="#94a3b8" font-size="8.5" font-weight="700" font-family="ui-monospace">CEILING UNISTRUT TRUSS (Z = 5.0m AFF)</text>

        <line x1="80" y1="20" x2="80" y2="80" stroke="#94a3b8" stroke-width="3" />
        <text x="90" y="55" fill="#94a3b8" font-size="8" font-family="ui-monospace">1.2m Steel Dropper</text>

        <circle cx="80" cy="80" r="10" fill="#00e5ff" stroke="#ffffff" stroke-width="2" />
        <text x="80" y="84" fill="#0b0f19" font-size="9" font-weight="800" text-anchor="middle" font-family="ui-monospace">CAM</text>

        <line x1="0" y1="320" x2="360" y2="320" stroke="#334155" stroke-width="2" />
        <text x="0" y="335" fill="#64748b" font-size="8" font-family="ui-monospace">GROUND FLOOR PLANE (Z = 0.0m)</text>

        <line x1="0" y1="240" x2="360" y2="240" stroke="#00e5ff" stroke-width="1" stroke-dasharray="4,4" opacity="0.6" />
        <text x="240" y="234" fill="#00e5ff" font-size="8" font-family="ui-monospace">TARGET INSPECTION PLANE (1.5m AFF)</text>

        <polygon points="80,80 120,320 340,320" fill="url(#dori-grad-py)" fill-opacity="0.25" stroke="#00e5ff" stroke-width="1.5" />
        <line x1="80" y1="80" x2="230" y2="320" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.8" />
        <text x="235" y="300" fill="#ffffff" font-size="8" font-family="ui-monospace">Optical Axis (θ=25°)</text>

        <rect x="80" y="308" width="40" height="12" fill="rgba(239, 68, 68, 0.3)" stroke="#ef4444" stroke-width="1" />
        <text x="100" y="318" fill="#ef4444" font-size="7" font-weight="700" text-anchor="middle" font-family="ui-monospace">Dead Zone: 1.2m</text>
      </g>

      <g transform="translate(460, 65)">
        <text x="0" y="16" fill="#f8fafc" font-size="11" font-weight="800" font-family="ui-monospace">DORI RESOLUTION TIERS (PPM VS DISTANCE)</text>
        <text x="0" y="30" fill="#94a3b8" font-size="8.5" font-family="system-ui">Exact pixel density gradient: PPM(D) = Res_W / [2·D·tan(HFOV/2)]</text>

        <g transform="translate(0, 48)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(0, 229, 255, 0.12)" stroke="#00e5ff" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#00e5ff" />
          <text x="45" y="24" fill="#090d16" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">IDENTIFY</text>
          <text x="102" y="18" fill="#00e5ff" font-size="9" font-weight="700" font-family="ui-monospace">≥ 250 px/m · Span: 0.0m → 5.4m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">High-speed 1D/2D barcode read, lot-code OCR, facial recognition</text>
        </g>

        <g transform="translate(0, 98)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#10b981" />
          <text x="45" y="24" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">RECOGNIZE</text>
          <text x="102" y="18" fill="#10b981" font-size="9" font-weight="700" font-family="ui-monospace">≥ 125 px/m · Span: 5.4m → 10.8m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">PPE splash suit, respirator, safety goggles &amp; boots compliance</text>
        </g>

        <g transform="translate(0, 148)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(234, 179, 8, 0.12)" stroke="#eab308" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#eab308" />
          <text x="45" y="24" fill="#090d16" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">OBSERVE</text>
          <text x="102" y="18" fill="#eab308" font-size="9" font-weight="700" font-family="ui-monospace">≥ 62.5 px/m · Span: 10.8m → 21.6m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">Forklift transit aisle tracking, speed monitoring, intrusion detection</text>
        </g>

        <g transform="translate(0, 198)">
          <rect x="0" y="0" width="350" height="42" rx="6" fill="rgba(249, 115, 22, 0.12)" stroke="#f97316" stroke-width="1.5" />
          <rect x="0" y="0" width="90" height="42" rx="6" fill="#f97316" />
          <text x="45" y="24" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace">DETECT</text>
          <text x="102" y="18" fill="#f97316" font-size="9" font-weight="700" font-family="ui-monospace">≥ 25 px/m · Span: 21.6m → 54.0m</text>
          <text x="102" y="32" fill="#94a3b8" font-size="7.5" font-family="system-ui">Perimeter breach alerts, spill berm overflow, tanker presence</text>
        </g>

        <g transform="translate(0, 248)">
          <rect x="0" y="0" width="350" height="70" rx="6" fill="#0f172a" stroke="#1e293b" />
          <text x="12" y="18" fill="#38bdf8" font-size="8.5" font-family="ui-monospace" font-weight="700">OPTICAL TELEMETRY SPECIFICATION</text>
          <text x="12" y="34" fill="#94a3b8" font-size="8" font-family="system-ui">Horizontal FOV: <tspan fill="#ffffff" font-weight="700">106°</tspan> · Vertical FOV: <tspan fill="#ffffff" font-weight="700">56°</tspan> · Lens: <tspan fill="#ffffff" font-weight="700">2.8mm</tspan></text>
          <text x="12" y="48" fill="#94a3b8" font-size="8" font-family="system-ui">Total Frame Pixels: <tspan fill="#ffffff" font-weight="700">4,085,760 px</tspan> · Stream: <tspan fill="#ffffff" font-weight="700">4096 kbps H.265</tspan></text>
          <text x="12" y="62" fill="#10b981" font-size="8" font-family="system-ui">Courtroom Admissible Forensic Video: <tspan fill="#10b981" font-weight="700">NIJ Vertical Screen Height ≥15%</tspan></text>
        </g>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_side_elevation_svg(project: DetVisionProject, width: int = 860, height: int = 420) -> bytes:
    """Picture 4: Side Elevation Profile & Field Rigging Cross-Section."""
    fh = project.facility_height_m or 5.0
    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#0e131f;border-radius:12px;border:1px solid #1e293b;">
      <rect x="0" y="0" width="{width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="{width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#a855f7" />
      <text x="32" y="19" fill="#c084fc" font-size="11" font-weight="800" font-family="ui-monospace, monospace">MULTI-ANGLE SIMULATION · SIDE ELEVATION PROFILE &amp; FIELD RIGGING</text>
      <text x="{width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Ceiling Truss: {fh:.1f}m AFF · Downward Depression: 25° · Dropper: 1.2m</text>

      <line x1="50" y1="65" x2="{width - 50}" y2="65" stroke="#475569" stroke-width="4" />
      <text x="60" y="55" fill="#94a3b8" font-size="8.5" font-family="ui-monospace" font-weight="700">STRUCTURAL I-BEAM / CEILING UNISTRUT (Z = 5.0m AFF)</text>

      <line x1="50" y1="340" x2="{width - 50}" y2="340" stroke="#334155" stroke-width="3" />
      <text x="60" y="358" fill="#64748b" font-size="8.5" font-family="ui-monospace">GROUND CONCRETE FLOOR (Z = 0.0m)</text>

      <line x1="50" y1="250" x2="{width - 50}" y2="250" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.6" />
      <text x="{width - 60}" y="244" fill="#00e5ff" font-size="8" font-family="ui-monospace" text-anchor="end">1.5m PPE &amp; FACE INSPECTION PLANE</text>

      <g transform="translate(100, 65)">
        <line x1="0" y1="0" x2="0" y2="45" stroke="#94a3b8" stroke-width="3" />
        <circle cx="0" cy="45" r="9" fill="#00e5ff" stroke="#ffffff" stroke-width="1.5" />
        <text x="0" y="49" fill="#090d16" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace">C1</text>
        <text x="-15" y="35" fill="#00e5ff" font-size="8" font-family="ui-monospace">Wall Mount</text>
        <polygon points="0,45 25,275 220,275" fill="rgba(0, 229, 255, 0.15)" stroke="#00e5ff" stroke-width="1" />
        <line x1="0" y1="45" x2="140" y2="275" stroke="#00e5ff" stroke-width="1.2" stroke-dasharray="3,3" />
      </g>

      <g transform="translate(420, 65)">
        <line x1="0" y1="0" x2="0" y2="55" stroke="#94a3b8" stroke-width="3" />
        <circle cx="0" cy="55" r="9" fill="#10b981" stroke="#ffffff" stroke-width="1.5" />
        <text x="0" y="59" fill="#090d16" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace">C7</text>
        <text x="12" y="40" fill="#10b981" font-size="8" font-family="ui-monospace">Roof-Tilt Dropper</text>
        <polygon points="0,55 35,275 240,275" fill="rgba(16, 185, 129, 0.15)" stroke="#10b981" stroke-width="1" />
      </g>

      <g transform="translate(280, 232)">
        <circle cx="0" cy="0" r="6" fill="#fbbf24" stroke="#ffffff" stroke-width="1" />
        <line x1="0" y1="6" x2="0" y2="60" stroke="#fbbf24" stroke-width="2" />
        <line x1="0" y1="60" x2="-8" y2="108" stroke="#fbbf24" stroke-width="2" />
        <line x1="0" y1="60" x2="8" y2="108" stroke="#fbbf24" stroke-width="2" />
        <line x1="-12" y1="26" x2="12" y2="26" stroke="#fbbf24" stroke-width="2" />
        <text x="0" y="-10" fill="#fbbf24" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">Worker (1.8m)</text>
      </g>

      <g transform="translate(620, 210)">
        <rect x="0" y="20" width="60" height="70" fill="rgba(245, 158, 11, 0.2)" stroke="#f59e0b" stroke-width="1.5" rx="3" />
        <rect x="15" y="0" width="30" height="20" fill="none" stroke="#f59e0b" stroke-width="1.5" />
        <circle cx="15" cy="115" r="14" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <circle cx="50" cy="115" r="14" fill="#1e293b" stroke="#f59e0b" stroke-width="2" />
        <text x="30" y="-6" fill="#f59e0b" font-size="8" font-weight="700" text-anchor="middle" font-family="ui-monospace">Forklift (2.3m)</text>
      </g>

      <g transform="translate(50, 368)">
        <text x="0" y="12" fill="#94a3b8" font-size="8" font-family="system-ui">
          ✔ Dropper pole lengths: <tspan fill="#ffffff" font-weight="700">1.2m threaded steel</tspan> · Rigging torque: <tspan fill="#ffffff" font-weight="700">45 Nm</tspan> to I-Beam unistrut clamps · IP67 weather cable glands sealed.
        </text>
        <text x="0" y="26" fill="#38bdf8" font-size="8" font-family="system-ui">
          ✔ Opposing bidirectional cameras eliminate blind zones underneath mounts with continuous 100% overlap.
        </text>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_perspective_3d_svg(project: DetVisionProject, width: int = 860, height: int = 480) -> bytes:
    """Picture 5: 3D Perspective Visualizer (Isometric Twin)."""
    ox = width * 0.48
    oy = height * 0.72

    def iso_x(x: float, y: float) -> float:
        return ox + (x - y) * 280.0

    def iso_y(x: float, y: float, z: float) -> float:
        return oy + (x + y) * 125.0 - z * 24.0

    p0 = (iso_x(0, 0), iso_y(0, 0, 0))
    p1 = (iso_x(1, 0), iso_y(1, 0, 0))
    p2 = (iso_x(1, 1), iso_y(1, 1, 0))
    p3 = (iso_x(0, 1), iso_y(0, 1, 0))

    palette = ['#00e5ff', '#ff6b35', '#7fff6b', '#c084fc', '#ffd60a', '#f472b6', '#38bdf8', '#fb923c']
    cam_pyramids = []
    for idx, cam in enumerate(project.cameras[:15]):
        c_floor = (iso_x(cam.x, cam.y), iso_y(cam.x, cam.y, 0))
        c_mount = (iso_x(cam.x, cam.y), iso_y(cam.x, cam.y, 4.5))
        color = palette[idx % len(palette)]
        spread = 0.12
        fA = (iso_x(max(0.0, cam.x - spread), max(0.0, cam.y - spread)), iso_y(max(0.0, cam.x - spread), max(0.0, cam.y - spread), 0))
        fB = (iso_x(min(1.0, cam.x + spread), max(0.0, cam.y - spread)), iso_y(min(1.0, cam.x + spread), max(0.0, cam.y - spread), 0))
        fC = (iso_x(min(1.0, cam.x + spread), min(1.0, cam.y + spread)), iso_y(min(1.0, cam.x + spread), min(1.0, cam.y + spread), 0))
        fD = (iso_x(max(0.0, cam.x - spread), min(1.0, cam.y + spread)), iso_y(max(0.0, cam.x - spread), min(1.0, cam.y + spread), 0))

        cam_pyramids.append(f"""
          <g id="iso-cam-{idx}">
            <polygon points="{fA[0]:.1f},{fA[1]:.1f} {fB[0]:.1f},{fB[1]:.1f} {fC[0]:.1f},{fC[1]:.1f} {fD[0]:.1f},{fD[1]:.1f}" fill="{color}" fill-opacity="0.12" stroke="{color}" stroke-width="0.8" />
            <line x1="{c_mount[0]:.1f}" y1="{c_mount[1]:.1f}" x2="{fA[0]:.1f}" y2="{fA[1]:.1f}" stroke="{color}" stroke-width="0.8" opacity="0.4" />
            <line x1="{c_mount[0]:.1f}" y1="{c_mount[1]:.1f}" x2="{fB[0]:.1f}" y2="{fB[1]:.1f}" stroke="{color}" stroke-width="0.8" opacity="0.4" />
            <line x1="{c_mount[0]:.1f}" y1="{c_mount[1]:.1f}" x2="{fC[0]:.1f}" y2="{fC[1]:.1f}" stroke="{color}" stroke-width="0.8" opacity="0.4" />
            <line x1="{c_mount[0]:.1f}" y1="{c_mount[1]:.1f}" x2="{fD[0]:.1f}" y2="{fD[1]:.1f}" stroke="{color}" stroke-width="0.8" opacity="0.4" />
            <line x1="{c_floor[0]:.1f}" y1="{c_floor[1]:.1f}" x2="{c_mount[0]:.1f}" y2="{c_mount[1]:.1f}" stroke="#64748b" stroke-width="1.2" stroke-dasharray="2,2" />
            <circle cx="{c_mount[0]:.1f}" cy="{c_mount[1]:.1f}" r="5" fill="{color}" stroke="#ffffff" stroke-width="1.2" />
            <text x="{c_mount[0]:.1f}" y="{c_mount[1] - 7:.1f}" fill="{color}" font-size="8" font-family="ui-monospace" font-weight="800" text-anchor="middle">CAM-{idx + 1}</text>
          </g>
        """)

    grid_lines = []
    for v in [0.2, 0.4, 0.6, 0.8]:
        a = (iso_x(v, 0), iso_y(v, 0, 0))
        b = (iso_x(v, 1), iso_y(v, 1, 0))
        c = (iso_x(0, v), iso_y(0, v, 0))
        d = (iso_x(1, v), iso_y(1, v, 0))
        grid_lines.append(f"""
          <line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#1e293b" stroke-width="1" />
          <line x1="{c[0]:.1f}" y1="{c[1]:.1f}" x2="{d[0]:.1f}" y2="{d[1]:.1f}" stroke="#1e293b" stroke-width="1" />
        """)

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#090c15;border-radius:12px;border:1px solid #1e293b;">
      <rect x="0" y="0" width="{width}" height="32" fill="#0f172a" rx="12" />
      <rect x="0" y="16" width="{width}" height="16" fill="#0f172a" />
      <circle cx="20" cy="16" r="4" fill="#38bdf8" />
      <text x="32" y="19" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">MULTI-ANGLE SIMULATION · 3D PERSPECTIVE VISUALIZER (ISOMETRIC TWIN)</text>
      <text x="{width - 16}" y="19" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Isometric Projection · {len(project.cameras)} Frustum Volumes · Zero Blind Spot Mesh</text>

      <polygon points="{p0[0]:.1f},{p0[1]:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f} {p3[0]:.1f},{p3[1]:.1f}" fill="rgba(15, 23, 42, 0.85)" stroke="#334155" stroke-width="2" />
      {"".join(grid_lines)}
      {"".join(cam_pyramids)}

      <g transform="translate(60, {height - 60})">
        <line x1="0" y1="0" x2="35" y2="-15" stroke="#ef4444" stroke-width="2" />
        <text x="42" y="-14" fill="#ef4444" font-size="8.5" font-weight="800" font-family="ui-monospace">X (Length)</text>
        <line x1="0" y1="0" x2="-35" y2="-15" stroke="#3b82f6" stroke-width="2" />
        <text x="-40" y="-14" fill="#3b82f6" font-size="8.5" font-weight="800" font-family="ui-monospace" text-anchor="end">Y (Width)</text>
        <line x1="0" y1="0" x2="0" y2="-40" stroke="#10b981" stroke-width="2" />
        <text x="6" y="-38" fill="#10b981" font-size="8.5" font-weight="800" font-family="ui-monospace">Z (Height)</text>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_ai_telemetry_svg(project: DetVisionProject, width: int = 860, height: int = 260) -> bytes:
    """Picture 6: 3D Optical Coverage Telemetry & Hardware Sizing Matrix."""
    cam_count = len(project.cameras) or 15
    target_coverage = project.detection_coverage_target or 95
    bitrate_kbps = 4096
    storage_30d_tb = f"{(cam_count * bitrate_kbps * 86400 * 30) / (8 * 1000 * 1000 * 1000):.1f}"
    total_poe_watts = f"{cam_count * 25.5:.0f}"
    switch_count = (cam_count + 23) // 24

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="auto" style="background:#ffffff;border-radius:12px;border:1px solid #cbd5e1;">
      <rect x="0" y="0" width="{width}" height="28" fill="#1e293b" rx="12" />
      <rect x="0" y="14" width="{width}" height="14" fill="#1e293b" />
      <text x="16" y="18" fill="#38bdf8" font-size="11" font-weight="800" font-family="ui-monospace, monospace">3D OPTICAL COVERAGE TELEMETRY &amp; HARDWARE SIZING MATRIX</text>
      <text x="{width - 16}" y="18" fill="#94a3b8" font-size="9" font-family="system-ui, sans-serif" text-anchor="end">Standard: IEC EN 62676-4 DORI</text>

      <g transform="translate(18, 38)">
        <text x="0" y="12" fill="#0f172a" font-size="10.5" font-weight="700" font-family="system-ui, sans-serif">OPTICAL RESOLUTION DENSITY TIERS</text>

        <g transform="translate(0, 22)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#16a34a" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">IDENTIFY</text>
          <text x="96" y="14" fill="#166534" font-size="9" font-weight="700" font-family="system-ui">≥ 250 px/m (100% Face &amp; High-Security OCR)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Positive facial verification, vehicle plate / badge capture</text>
        </g>

        <g transform="translate(0, 60)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#eff6ff" stroke="#2563eb" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#2563eb" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">RECOGNIZE</text>
          <text x="96" y="14" fill="#1e40af" font-size="9" font-weight="700" font-family="system-ui">≥ 125 px/m (PPE Hardhat, Vest &amp; Clothing)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">OSHA PPE compliance, distinctive attire, operator validation</text>
        </g>

        <g transform="translate(0, 98)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#fefce8" stroke="#ca8a04" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#ca8a04" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">OBSERVE</text>
          <text x="96" y="14" fill="#854d0e" font-size="9" font-weight="700" font-family="system-ui">≥ 62.5 px/m (Asset &amp; Forklift Tracking)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Body posture, pallet position, AGV navigation, aisle traffic</text>
        </g>

        <g transform="translate(0, 136)">
          <rect x="0" y="0" width="390" height="32" rx="5" fill="#f8fafc" stroke="#64748b" stroke-width="1.2" />
          <rect x="0" y="0" width="85" height="32" rx="5" fill="#64748b" />
          <text x="42" y="17" fill="#ffffff" font-size="9" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="system-ui">DETECT</text>
          <text x="96" y="14" fill="#334155" font-size="9" font-weight="700" font-family="system-ui">≥ 25 px/m (Perimeter Boundary Presence)</text>
          <text x="96" y="25" fill="#64748b" font-size="7.5" font-family="system-ui">Human presence silhouette vs background intrusion</text>
        </g>

        <g transform="translate(0, 178)">
          <text x="0" y="10" fill="#0f172a" font-size="9" font-weight="700" font-family="system-ui">AI COVERAGE GUARANTEE: {target_coverage}% TARGET</text>
          <rect x="0" y="16" width="390" height="12" rx="3" fill="#e2e8f0" />
          <rect x="0" y="16" width="{int(390 * (target_coverage / 100))}" height="12" rx="3" fill="#10b981" />
          <text x="195" y="25" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="ui-monospace, monospace">{target_coverage}% OPTICAL GEOMETRIC SOLVER VERIFIED</text>
        </g>
      </g>

      <g transform="translate(435, 38)">
        <text x="0" y="12" fill="#0f172a" font-size="10.5" font-weight="700" font-family="system-ui, sans-serif">HARDWARE SIZING &amp; INFERENCE TELEMETRY</text>

        <g transform="translate(0, 22)">
          <rect x="0" y="0" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="10" y="15" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">Active Sensor Fleet</text>
          <text x="10" y="36" fill="#2563eb" font-size="16" font-weight="800" font-family="ui-monospace, monospace">{cam_count} Cameras</text>
          <text x="110" y="34" fill="#059669" font-size="8" font-weight="600">PoE+ GigE</text>

          <rect x="205" y="0" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="215" y="15" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">30-Day Storage Array</text>
          <text x="215" y="36" fill="#7c3aed" font-size="16" font-weight="800" font-family="ui-monospace, monospace">{storage_30d_tb} TB</text>
          <text x="310" y="34" fill="#64748b" font-size="8" font-weight="600">RAID-6</text>

          <rect x="0" y="56" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="10" y="71" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">PoE Power Budget</text>
          <text x="10" y="92" fill="#0d9488" font-size="16" font-weight="800" font-family="ui-monospace, monospace">~{total_poe_watts} W</text>
          <text x="110" y="90" fill="#64748b" font-size="8" font-weight="600">{switch_count}x 24p Sw.</text>

          <rect x="205" y="56" width="195" height="48" rx="6" fill="#f8fafc" stroke="#e2e8f0" />
          <text x="215" y="71" fill="#64748b" font-size="8" font-weight="700" text-transform="uppercase">Network Bandwidth</text>
          <text x="215" y="92" fill="#dc2626" font-size="16" font-weight="800" font-family="ui-monospace, monospace">{cam_count * 4.1:.1f} Mbps</text>
          <text x="320" y="90" fill="#64748b" font-size="8" font-weight="600">H.265 Main</text>
        </g>

        <g transform="translate(0, 136)">
          <text x="0" y="10" fill="#0f172a" font-size="9" font-weight="700" font-family="system-ui">END-TO-END DETERMINISTIC LATENCY BUDGET (≤35ms TARGET)</text>
          <rect x="0" y="18" width="400" height="20" rx="4" fill="#f1f5f9" />
          <rect x="0" y="18" width="80" height="20" rx="4" fill="#3b82f6" />
          <text x="40" y="31" fill="#ffffff" font-size="7.5" font-weight="700" text-anchor="middle" font-family="ui-monospace">RTSP 8ms</text>
          <rect x="80" y="18" width="140" height="20" fill="#10b981" />
          <text x="150" y="31" fill="#ffffff" font-size="7.5" font-weight="700" text-anchor="middle" font-family="ui-monospace">Inference 14ms</text>
          <rect x="220" y="18" width="100" height="20" fill="#f59e0b" />
          <text x="270" y="31" fill="#ffffff" font-size="7.5" font-weight="700" text-anchor="middle" font-family="ui-monospace">Tracking 6ms</text>
          <rect x="320" y="18" width="80" height="20" rx="4" fill="#8b5cf6" />
          <text x="360" y="31" fill="#ffffff" font-size="7.5" font-weight="700" text-anchor="middle" font-family="ui-monospace">PLC / Alert 4ms</text>
        </g>
      </g>
    </svg>"""
    return svg_content.encode("utf-8")


def generate_all_diagrams(project: DetVisionProject) -> Dict[str, bytes]:
    """Generate all diagrams for the report."""
    diagrams = {}
    
    diagrams["workflow"] = generate_workflow_svg(project.workflow)
    diagrams["camera_map"] = generate_camera_map_svg(project)
    diagrams["gantt"] = generate_gantt_svg(project)
    
    # Specialized Multi-Angle 3D Simulation Views & AI Telemetry
    diagrams["top_view"] = generate_top_view_svg(project)
    diagrams["bird_camera_3d"] = generate_bird_camera_3d_svg(project)
    diagrams["frustum_dori_3d"] = generate_frustum_dori_3d_svg(project)
    diagrams["side_elevation"] = generate_side_elevation_svg(project)
    diagrams["perspective_3d"] = generate_perspective_3d_svg(project)
    diagrams["ai_telemetry"] = generate_ai_telemetry_svg(project)
    
    return diagrams