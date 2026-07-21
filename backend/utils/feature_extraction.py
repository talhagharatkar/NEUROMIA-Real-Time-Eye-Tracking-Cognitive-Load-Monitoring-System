def cleanse_and_validate_features(data: dict) -> dict:
    """
    Cleanses and validates the incoming feature dictionary from the frontend.
    Fills in missing values with defaults if they are not provided, ensuring consistency.
    """
    expected_fields = {
        "timestamp": float,
        "session_id": str,
        "ear_l": float,
        "ear_r": float,
        "ear_avg": float,
        "blink_count": int,
        "blink_duration": float,
        "blink_frequency": float,
        "avg_blink_duration": float,
        "inter_blink_interval": float,
        "perclos": float,
        "eye_closure_pct": float,
        "yaw": float,
        "pitch": float,
        "roll": float,
        "mouth_aspect_ratio": float,
        "face_confidence": float,
        "fps": float,
        "cognitive_load_label": float  # Can be float/int or None
    }
    
    clean_data = {}
    for field, field_type in expected_fields.items():
        val = data.get(field)
        
        if val is None or val == "" or val == "null":
            clean_data[field] = None
        else:
            try:
                clean_data[field] = field_type(val)
            except (ValueError, TypeError):
                # Fallback to zero-like default if parsing fails
                clean_data[field] = field_type()
                
    return clean_data
