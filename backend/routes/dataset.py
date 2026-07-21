import os
import glob
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

@router.get("/")
def list_datasets():
    """List all available session CSV files."""
    dataset_dir = "backend/datasets"
    if not os.path.exists(dataset_dir):
        return {"datasets": []}
        
    csv_pattern = os.path.join(dataset_dir, "*.csv")
    csv_files = glob.glob(csv_pattern)
    
    datasets = []
    for f in csv_files:
        basename = os.path.basename(f)
        size = os.path.getsize(f)
        mtime = os.path.getmtime(f)
        
        # Read header and count rows
        row_count = 0
        try:
            with open(f, "r", encoding="utf-8") as file:
                row_count = sum(1 for line in file) - 1  # subtract header
        except:
            pass
            
        datasets.append({
            "filename": basename,
            "size_bytes": size,
            "last_modified": mtime,
            "row_count": row_count
        })
        
    # Sort by last modified descending
    datasets.sort(key=lambda x: x["last_modified"], reverse=True)
    return {"datasets": datasets}

@router.get("/download/{filename}")
def download_dataset(filename: str):
    """Download a specific CSV file."""
    # Prevent directory traversal attacks
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename format.")
        
    file_path = os.path.join("backend/datasets", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset not found.")
        
    return FileResponse(
        path=file_path,
        media_type="text/csv",
        filename=filename
    )
