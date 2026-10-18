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


def generate_all_diagrams(project: DetVisionProject) -> Dict[str, bytes]:
    """Generate all diagrams for the report."""
    diagrams = {}
    
    diagrams["workflow"] = generate_workflow_svg(project.workflow)
    diagrams["camera_map"] = generate_camera_map_svg(project)
    diagrams["gantt"] = generate_gantt_svg(project)
    
    return diagrams