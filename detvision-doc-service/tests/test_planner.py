import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.planner import generate_structured_layout, generate_token_free_safety_plan, extract_desired_camera_count


def test_camera_count_extraction():
    assert extract_desired_camera_count("We need 70 cameras in our warehouse bay") == 70
    assert extract_desired_camera_count("Deploy 50 cctv units across the facility") == 50
    assert extract_desired_camera_count("Small room setup", explicit_count=12) == 12


def test_large_scale_70_cameras_layout():
    scenario = "We have a large 90m x 15m logistics warehouse bay with 70 cameras needed, storage racks, loading docks and forklifts."
    layout = generate_structured_layout(scenario)
    
    assert layout["camera_count"] == 70
    assert len(layout["cameras"]) == 70
    assert len(layout["structure"]) >= 10
    
    # Verify obstacles exist
    obstacles = [s for s in layout["structure"] if s["type"] == "obstacle"]
    assert len(obstacles) >= 6
    
    # Verify angles and mounts are varied
    angles = set(c["orientation_degrees"] for c in layout["cameras"])
    mounts = set(c["mount_type"] for c in layout["cameras"])
    
    assert len(angles) >= 4, f"Expected varied angles, got {angles}"
    assert len(mounts) >= 3, f"Expected multiple mount types, got {mounts}"


def test_token_free_safety_plan():
    project = {
        "business_description": "Large automated fulfillment center with 70 cameras.",
        "industry": "E-Commerce Logistics",
        "company_name": "Apex Fulfillment",
        "requirements": ["PPE compliance", "Forklift collision avoidance"],
    }
    plan = generate_token_free_safety_plan(project)
    
    assert plan["complete"] is True
    assert "exec_summary" in plan["sections"]
    assert "camera_coverage_plan" in plan["sections"]
    assert plan["token_usage"]["api_tokens_consumed"] == 0
    assert plan["token_usage"]["saved_billable_tokens"] > 0
