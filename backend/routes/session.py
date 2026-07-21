import os
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# In-memory session state
class SessionState:
    active_session_id = None
    active_file_path = None
    start_time = None
    subject_info = {}

session_state = SessionState()

class StartSessionRequest(BaseModel):
    subject_id: str
    session_id: str
    age: int = None
    gender: str = None
    glasses: str = None

@router.post("/start")
def start_session(req: StartSessionRequest):
    if session_state.active_session_id is not None:
        return {
            "success": True, 
            "message": "Session already active.", 
            "session_id": session_state.active_session_id
        }
    
    session_state.active_session_id = req.session_id
    session_state.start_time = time.time()
    session_state.subject_info = {
        "subject_id": req.subject_id,
        "age": req.age,
        "gender": req.gender,
        "glasses": req.glasses
    }
    
    # Create dataset file
    os.makedirs("backend/datasets", exist_ok=True)
    filename = f"session_{req.subject_id}_{req.session_id}_{int(session_state.start_time)}.csv"
    session_state.active_file_path = os.path.join("backend/datasets", filename)
    
    # Initialize CSV header
    headers = [
        "timestamp", "session_id", "subject_id",
        "ear_l", "ear_r", "ear_avg",
        "blink_count", "blink_duration", "blink_frequency",
        "avg_blink_duration", "inter_blink_interval",
        "perclos", "eye_closure_pct",
        "yaw", "pitch", "roll",
        "mouth_aspect_ratio", "face_confidence", "fps",
        "cognitive_load_label"
    ]
    
    try:
        with open(session_state.active_file_path, "w", encoding="utf-8") as f:
            f.write(",".join(headers) + "\n")
        print(f"[Session] Started session {req.session_id}. File: {session_state.active_file_path}")
    except Exception as e:
        session_state.active_session_id = None
        session_state.active_file_path = None
        raise HTTPException(status_code=500, detail=f"Failed to create session file: {e}")
        
    return {
        "success": True,
        "session_id": req.session_id,
        "file_path": session_state.active_file_path
    }

@router.post("/stop")
def stop_session():
    if session_state.active_session_id is None:
        raise HTTPException(status_code=400, detail="No active session to stop.")
        
    prev_id = session_state.active_session_id
    session_state.active_session_id = None
    session_state.active_file_path = None
    session_state.start_time = None
    session_state.subject_info = {}
    
    return {
        "success": True,
        "message": f"Session {prev_id} stopped."
    }

@router.get("/status")
def get_session_status():
    return {
        "active": session_state.active_session_id is not None,
        "session_id": session_state.active_session_id,
        "start_time": session_state.start_time,
        "subject_info": session_state.subject_info
    }
