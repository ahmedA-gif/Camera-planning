from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import uuid


class TaskType(str, Enum):
    OBJECT_DETECTION = "object_detection"
    CLASSIFICATION = "classification"
    SEGMENTATION = "segmentation"
    OCR = "ocr"
    MEASUREMENT = "measurement"
    TRACKING = "tracking"
    COUNTING = "counting"
    ANOMALY_DETECTION = "anomaly_detection"
    POSE_ESTIMATION = "pose_estimation"
    OTHER = "other"


class FeasibilityStatus(str, Enum):
    FEASIBLE = "feasible"
    CONDITIONAL = "conditional"
    INFEASIBLE = "infeasible"
    UNKNOWN = "unknown"


class CameraStatus(str, Enum):
    PLANNED = "planned"
    INSTALLED = "installed"
    ACTIVE = "active"
    MAINTENANCE = "maintenance"
    OFFLINE = "offline"


class ZoneType(str, Enum):
    DETECTION = "detection"
    COUNTING = "counting"
    EXCLUSION = "exclusion"
    ROI = "roi"
    VIRTUAL_LINE = "virtual_line"


class NodeCategory(str, Enum):
    CAMERA_INPUT = "camera_input"
    FRAME_SAMPLING = "frame_sampling"
    PREPROCESSING = "preprocessing"
    OBJECT_DETECTION = "object_detection"
    CLASSIFICATION = "classification"
    SEGMENTATION = "segmentation"
    OCR = "ocr"
    MEASUREMENT = "measurement"
    TRACKING = "tracking"
    ZONE_LOGIC = "zone_logic"
    LINE_CROSSING = "line_crossing"
    DECISION = "decision"
    ALERT = "alert"
    EVENT_STORAGE = "event_storage"
    MANUAL_REVIEW = "manual_review"


class Point(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class UseCase(BaseModel):
    id: str
    name: str
    description: str
    task_type: TaskType
    candidate_techniques: List[str]
    input_description: str
    output_description: str
    camera_ids: List[str]
    feasibility_status: FeasibilityStatus
    feasibility_notes: List[str]
    acceptance_criteria: List[str]
    assumptions: List[str]


class Camera(BaseModel):
    id: str
    name: str
    status: CameraStatus
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    orientation_degrees: float = Field(ge=0, le=360)
    horizontal_fov_degrees: float = Field(ge=1, le=180)
    view_range: float = Field(ge=0.1, le=1)
    resolution_width: int = Field(gt=0)
    resolution_height: int = Field(gt=0)
    assigned_use_case_ids: List[str]


class Zone(BaseModel):
    id: str
    name: str
    type: ZoneType
    points: List[Point]
    camera_ids: List[str]
    color: str


class StructureElement(BaseModel):
    id: str
    name: str
    type: str
    points: List[Point] = Field(default_factory=list)
    x_m: Optional[float] = None
    y_m: Optional[float] = None
    width_m: Optional[float] = None
    depth_m: Optional[float] = None
    height_m: Optional[float] = None
    obstacle_type: Optional[str] = None


class WorkflowNode(BaseModel):
    id: str
    type: NodeCategory
    position: Dict[str, float]
    data: Dict[str, Any]


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None


class Workflow(BaseModel):
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]


class DetVisionProject(BaseModel):
    id: str
    name: str
    company_name: str
    industry: str
    business_description: str
    requirements: List[str]
    use_cases: List[UseCase]
    cameras: List[Camera]
    zones: List[Zone]
    structure: List[StructureElement] = Field(default_factory=list)
    workflow: Workflow
    assumptions: List[str]
    missing_information: List[str]
    created_at: str
    updated_at: str
    facility_image: Optional[str] = None
    facility_image_name: Optional[str] = None
    image_observation: Optional[str] = None
    camera_specifications: Optional[str] = None
    camera_recommendations: List[str] = Field(default_factory=list)
    available_hardware: Optional[str] = None
    critical_components: List[str] = Field(default_factory=list)
    layout_section_count: Optional[int] = None
    layout_sections: List[str] = Field(default_factory=list)
    detection_coverage_target: Optional[int] = None
    output_scope: List[str] = Field(default_factory=list)
    facility_width_m: Optional[float] = None
    facility_length_m: Optional[float] = None
    facility_height_m: Optional[float] = None
    facility_type: Optional[str] = None


class ReportRequest(BaseModel):
    project: DetVisionProject
    format: str = Field(default="pdf", pattern="^(pdf|docx)$")
    include_diagrams: bool = True


class ReportResponse(BaseModel):
    content: bytes
    filename: str
    content_type: str
