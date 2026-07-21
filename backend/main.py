import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from backend.routes import session, training, dataset
from backend.routes.session import session_state
from backend.models.random_forest import RandomForestModel
from backend.utils.feature_extraction import cleanse_and_validate_features

app = FastAPI(title="Neuromia Cognitive Intelligence Backend", version="1.0")

# Setup CORS for frontend local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local single-user testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(session.router, prefix="/api/session", tags=["Session"])
app.include_router(training.router, prefix="/api/training", tags=["Training"])
app.include_router(dataset.router, prefix="/api/dataset", tags=["Dataset"])

@app.get("/")
def get_root():
    return {"status": "running", "system": "Neuromia MVP"}

@app.websocket("/ws/stream")
async def ws_stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[WebSocket] Client connected.")
    
    # Initialize Random Forest model wrapper
    model_wrapper = RandomForestModel()
    
    try:
        while True:
            # Receive frame data from client
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            
            # Clean and validate features
            clean_data = cleanse_and_validate_features(data)
            
            # If a session is active, write to CSV dataset file
            if session_state.active_session_id is not None and session_state.active_file_path is not None:
                # Align fields with headers
                row_fields = [
                    str(clean_data["timestamp"]),
                    str(session_state.active_session_id),
                    str(session_state.subject_info.get("subject_id", "P001")),
                    str(clean_data["ear_l"]),
                    str(clean_data["ear_r"]),
                    str(clean_data["ear_avg"]),
                    str(clean_data["blink_count"]),
                    str(clean_data["blink_duration"]),
                    str(clean_data["blink_frequency"]),
                    str(clean_data["avg_blink_duration"]),
                    str(clean_data["inter_blink_interval"]),
                    str(clean_data["perclos"]),
                    str(clean_data["eye_closure_pct"]),
                    str(clean_data["yaw"]),
                    str(clean_data["pitch"]),
                    str(clean_data["roll"]),
                    str(clean_data["mouth_aspect_ratio"]),
                    str(clean_data["face_confidence"]),
                    str(clean_data["fps"]),
                    # Nullable target label
                    "" if clean_data["cognitive_load_label"] is None else str(clean_data["cognitive_load_label"])
                ]
                
                try:
                    with open(session_state.active_file_path, "a", encoding="utf-8") as f:
                        f.write(",".join(row_fields) + "\n")
                except Exception as e:
                    print(f"[WebSocket] Error writing to CSV: {e}")
            
            # Run model inference if trained
            # We refresh the model state if needed or query the loaded model wrapper
            # To ensure hot-reloading when user trains a new model, we reload model weights
            # if the wrapper isn't trained yet, or periodically
            if not model_wrapper.is_trained():
                model_wrapper.load()
                
            prediction_res = model_wrapper.predict(clean_data)
            
            if prediction_res is not None:
                response = {
                    "status": "success",
                    "prediction": prediction_res["prediction"],
                    "confidence": prediction_res["confidence"]
                }
            else:
                response = {
                    "status": "unavailable",
                    "message": "Model not yet trained."
                }
                
            # Send prediction back to frontend
            await websocket.send_text(json.dumps(response))
            
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected.")
    except Exception as e:
        print(f"[WebSocket] Error: {e}")
        
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
