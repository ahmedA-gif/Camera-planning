from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from app.planner import generate_structured_layout, generate_token_free_safety_plan
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class LayoutRequest(BaseModel):
    scenario: str
    desired_camera_count: Optional[int] = None
    use_cases: Optional[List[Dict[str, Any]]] = None
    project: Optional[Dict[str, Any]] = None


class PlanRequest(BaseModel):
    project: Dict[str, Any]


@router.post("/layout")
async def create_layout(request: LayoutRequest):
    """Generate structured camera planning (supporting 70+ cameras) with obstacles and keyword reasoning."""
    try:
        scenario = request.scenario
        if not scenario and request.project:
            scenario = request.project.get("business_description", "")
        
        explicit_count = request.desired_camera_count
        if not explicit_count and request.project:
            explicit_count = request.project.get("desired_camera_count")

        use_cases = request.use_cases
        if not use_cases and request.project:
            use_cases = request.project.get("use_cases", [])

        layout = generate_structured_layout(
            scenario_text=scenario or "Warehouse facility",
            desired_camera_count=explicit_count,
            use_cases=use_cases,
        )
        return layout
    except Exception as e:
        logger.error(f"Layout generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/safety-plan")
async def create_safety_plan(request: PlanRequest):
    """Generate token-free safety plan and token usage breakdown using Python rule engine."""
    try:
        plan = generate_token_free_safety_plan(request.project)
        return plan
    except Exception as e:
        logger.error(f"Safety plan generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
