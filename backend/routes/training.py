from fastapi import APIRouter
from backend.training.train_pipeline import run_training
from backend.models.random_forest import RandomForestModel

router = APIRouter()

@router.post("/train")
def train_model():
    """Trigger the ML training pipeline and return metrics."""
    result = run_training()
    return result

@router.get("/metrics")
def get_model_status():
    """Check if model is trained and get metadata."""
    model_wrapper = RandomForestModel()
    trained = model_wrapper.is_trained()
    
    return {
        "is_trained": trained,
        "features": model_wrapper.feature_names if trained else []
    }
