import os
import glob
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
from backend.models.random_forest import RandomForestModel

# Define standard feature list for Neuromia Phase 1
FEATURES = [
    "ear_l", "ear_r", "ear_avg",
    "blink_count", "blink_duration", "blink_frequency",
    "avg_blink_duration", "inter_blink_interval",
    "perclos", "eye_closure_pct",
    "yaw", "pitch", "roll",
    "mouth_aspect_ratio", "face_confidence", "fps"
]

TARGET = "cognitive_load_label"

def run_training(dataset_dir="backend/datasets", model_dir="backend/models"):
    """
    Load all session CSVs, train a Random Forest model, evaluate it, and save.
    Returns a dictionary of evaluation metrics.
    """
    csv_pattern = os.path.join(dataset_dir, "*.csv")
    csv_files = glob.glob(csv_pattern)
    
    if not csv_files:
        return {"success": False, "error": "No CSV files found in dataset directory."}
        
    # Read and concatenate all CSV data
    dataframes = []
    for f in csv_files:
        try:
            df = pd.read_csv(f)
            dataframes.append(df)
        except Exception as e:
            print(f"[TrainPipeline] Error reading {f}: {e}")
            
    if not dataframes:
        return {"success": False, "error": "Could not read any CSV files."}
        
    df = pd.concat(dataframes, ignore_index=True)
    
    # Drop rows where the target label is missing
    if TARGET not in df.columns:
        return {"success": False, "error": f"Target column '{TARGET}' not found in the datasets."}
        
    df = df.dropna(subset=[TARGET])
    
    if len(df) < 20:
        return {"success": False, "error": f"Insufficient labeled data for training. Found {len(df)} rows, minimum required is 20."}

    # Ensure all required features are present in the dataframe
    missing_features = [col for col in FEATURES if col not in df.columns]
    if missing_features:
        # Create them with default values (0.0) if missing, to prevent crashes
        for col in missing_features:
            df[col] = 0.0
            
    X = df[FEATURES].copy()
    y = df[TARGET].astype(int)

    # Impute missing values in features with mean
    for col in FEATURES:
        if X[col].isnull().any():
            mean_val = X[col].mean()
            X[col] = X[col].fillna(mean_val if pd.notnull(mean_val) else 0.0)
            
    # Split into train/test
    # If the dataset is too small, skip train/test split metrics or use a smaller test size
    test_size = 0.2
    if len(df) < 50:
        test_size = 0.1
        
    # Check if there are at least 2 unique classes in target to train/test split properly
    unique_classes = np.unique(y)
    if len(unique_classes) < 2:
        return {"success": False, "error": f"Training requires at least 2 unique cognitive load levels. Currently found only: {unique_classes}"}

    # Perform stratified split if possible, otherwise normal split
    try:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42, stratify=y
        )
    except ValueError:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )

    # Scaling
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Train Random Forest Classifier - tuned to increase accuracy and prevent overfitting on small datasets
    rf = RandomForestClassifier(
        n_estimators=150,
        max_depth=8,
        min_samples_split=3,
        min_samples_leaf=2,
        class_weight='balanced',
        random_state=42
    )
    rf.fit(X_train_scaled, y_train)

    # Predictions
    y_pred = rf.predict(X_test_scaled)
    
    # Calculate basic classification metrics
    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, average="macro", zero_division=0)
    recall = recall_score(y_test, y_pred, average="macro", zero_division=0)
    f1 = f1_score(y_test, y_pred, average="macro", zero_division=0)
    
    # Calculate ROC-AUC if probabilities are available
    roc_auc = "N/A"
    try:
        if hasattr(rf, "predict_proba"):
            y_prob = rf.predict_proba(X_test_scaled)
            # multi_class='ovr' requires multi-class probabilities
            # If binary, scikit-learn needs 1D array of positive class probabilities
            if len(unique_classes) == 2:
                roc_auc = roc_auc_score(y_test, y_prob[:, 1])
            else:
                roc_auc = roc_auc_score(y_test, y_prob, multi_class="ovr", average="macro")
    except Exception as e:
        print(f"[TrainPipeline] ROC-AUC calculation error: {e}")
        
    # Confusion Matrix
    cm = confusion_matrix(y_test, y_pred)
    confusion_matrix_list = cm.tolist()
    
    # Cross Validation Score (use 3-fold or 5-fold based on dataset size)
    cv_folds = 5 if len(X) >= 50 else 3
    try:
        cv_scores = cross_val_score(rf, scaler.fit_transform(X), y, cv=cv_folds)
        cv_mean = float(np.mean(cv_scores))
    except Exception as e:
        print(f"[TrainPipeline] Cross-validation error: {e}")
        cv_mean = 0.0

    # Save model using our model wrapper
    model_wrapper = RandomForestModel(model_dir=model_dir)
    model_wrapper.save(rf, scaler, FEATURES)

    return {
        "success": True,
        "metrics": {
            "accuracy": float(accuracy),
            "precision": float(precision),
            "recall": float(recall),
            "f1_score": float(f1),
            "roc_auc": float(roc_auc) if isinstance(roc_auc, (int, float)) else roc_auc,
            "confusion_matrix": confusion_matrix_list,
            "cross_val_score": cv_mean,
            "classes": [int(c) for c in unique_classes],
            "total_rows": len(df)
        }
    }
