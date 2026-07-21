import os
import joblib

class RandomForestModel:
    def __init__(self, model_dir="backend/models", model_name="random_forest.joblib"):
        self.model_path = os.path.join(model_dir, model_name)
        self.model = None
        self.scaler = None
        self.feature_names = None
        self.load()

    def load(self):
        """Load the model and scaler if they exist."""
        if os.path.exists(self.model_path):
            try:
                data = joblib.load(self.model_path)
                self.model = data.get("model")
                self.scaler = data.get("scaler")
                self.feature_names = data.get("features", [])
                print(f"[RandomForestModel] Model loaded successfully from {self.model_path}")
            except Exception as e:
                print(f"[RandomForestModel] Error loading model from {self.model_path}: {e}")
                self.model = None
                self.scaler = None

    def save(self, model, scaler, features):
        """Save the trained model, scaler, and features metadata."""
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        data = {
            "model": model,
            "scaler": scaler,
            "features": features
        }
        joblib.dump(data, self.model_path)
        self.model = model
        self.scaler = scaler
        self.feature_names = features
        print(f"[RandomForestModel] Model saved to {self.model_path}")

    def is_trained(self):
        return self.model is not None

    def predict(self, feature_dict):
        """
        Predict cognitive load given a dictionary of extracted features.
        Returns a dictionary containing the prediction label and probability/confidence.
        If the model is not trained, returns None.
        """
        if not self.is_trained():
            return None

        # Build feature vector matching features used during training
        try:
            vector = []
            for col in self.feature_names:
                vector.append(feature_dict.get(col, 0.0))
            
            # Apply scaling
            X = [vector]
            if self.scaler is not None:
                X = self.scaler.transform(X)
                
            prediction = self.model.predict(X)[0]
            
            # Get probability confidence if supported
            confidence = 1.0
            if hasattr(self.model, "predict_proba"):
                probs = self.model.predict_proba(X)[0]
                pred_idx = list(self.model.classes_).index(prediction)
                confidence = probs[pred_idx]
                
            return {
                "prediction": int(prediction),
                "confidence": float(confidence)
            }
        except Exception as e:
            print(f"[RandomForestModel] Prediction error: {e}")
            return None
