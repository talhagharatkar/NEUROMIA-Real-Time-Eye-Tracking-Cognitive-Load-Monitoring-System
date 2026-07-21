#!/usr/bin/env python
"""
NEUROMIA Cognitive Load LSTM Classifier (cognitive_load_classifier.py)
--------------------------------------------------------------------
Demonstrates how to combine oculometric features (from efg.html's CSV export)
with 14-channel Emotiv EEG metrics/wave bands, and train a 2-layer LSTM network
in PyTorch to classify cognitive load into four states:
  0: Low Load
  1: Moderate Load
  2: High Load
  3: Cognitive Shock

This script:
1. Synthesizes a realistic CSV dataset (combined_cognitive_dataset.csv).
2. Preprocesses and normalizes the features.
3. Defines a 2-layer PyTorch LSTM model.
4. Trains the model and prints accuracy metrics.
5. Performs real-time inference on a new sequence.
"""

import os
import time
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

# Setup random seed for reproducibility
np.random.seed(42)
torch.manual_seed(42)

# ==========================================
# PHASE 1: GENERATE COMBINED DATASET
# ==========================================
def generate_combined_dataset(filepath, num_sessions=15, rows_per_session=40):
    """
    Generates a synthetic dataset modeling the combined eye-tracking and
    Emotiv 14-channel EEG features across three experimental conditions:
      - AI_ASSISTED (Low/Moderate Load)
      - NON_AI (Moderate/High Load)
      - AI_STOPPED (Cognitive Shock)
    """
    print(">>> Generating combined dataset...")
    
    modes = ['AI_ASSISTED', 'NON_AI', 'AI_STOPPED']
    states = ['RELAXED', 'OPTIMAL', 'ELEVATED', 'OVERLOAD']
    
    data_rows = []
    
    for sess_idx in range(num_sessions):
        session_id = f"NM-SESS{sess_idx:02d}"
        subject_id = f"SUB-{100 + sess_idx}"
        
        # Distribute conditions
        mode = modes[sess_idx % len(modes)]
        
        # Starting timestamp
        start_ts = int(time.time() * 1000) - (sess_idx * 86400 * 1000)
        
        for row_idx in range(rows_per_session):
            ts = start_ts + (row_idx * 8200) # every 8.2 seconds
            dt_iso = pd.to_datetime(ts, unit='ms').isoformat()
            
            # 1. Base Oculometrics
            if mode == 'AI_ASSISTED':
                br = np.random.uniform(10, 16)         # Low blink rate
                gs = np.random.uniform(85, 96)         # High gaze stability
                at = np.random.uniform(65, 80)         # Balanced attention
                ec = np.random.uniform(5, 12)          # Low eye closure duration
                tb = 10 + int(row_idx * 1.5)           # Running blink count
                ibi = np.random.uniform(4000, 6000)    # Longer intervals
                fatigue = np.random.uniform(15, 35)    # Low fatigue
                alert_state = 'OPTIMAL'
                conf = np.random.uniform(88, 97)
                cog_load_class = 0 # Low Load
                
            elif mode == 'NON_AI':
                br = np.random.uniform(16, 23)         # Medium-high blink rate
                gs = np.random.uniform(65, 82)         # Moderate gaze stability
                at = np.random.uniform(70, 92)         # High focused attention
                ec = np.random.uniform(8, 18)          # Moderate eye closure
                tb = 15 + int(row_idx * 2.2)
                ibi = np.random.uniform(2500, 3800)    # Shorter intervals
                fatigue = np.random.uniform(30, 55)    # Moderate fatigue
                alert_state = 'ELEVATED'
                conf = np.random.uniform(85, 95)
                cog_load_class = 2 # High Load
                
            else: # AI_STOPPED (Cognitive Shock)
                # Introduce sudden transition to shock halfway through session
                if row_idx >= rows_per_session // 2:
                    br = np.random.uniform(25, 42)     # Rapid blinking/stress
                    gs = np.random.uniform(35, 58)     # Poor gaze stability
                    at = np.random.uniform(30, 55)     # Drop in attention
                    ec = np.random.uniform(20, 38)     # High eye closure/PERCLOS
                    tb = 25 + int(row_idx * 4.0)
                    ibi = np.random.uniform(1200, 2000)
                    fatigue = np.random.uniform(60, 85)
                    alert_state = 'OVERLOAD'
                    conf = np.random.uniform(75, 88)
                    cog_load_class = 3 # Cognitive Shock
                else:
                    br = np.random.uniform(15, 20)
                    gs = np.random.uniform(80, 90)
                    at = np.random.uniform(68, 85)
                    ec = np.random.uniform(8, 14)
                    tb = 12 + int(row_idx * 1.8)
                    ibi = np.random.uniform(3000, 4500)
                    fatigue = np.random.uniform(25, 40)
                    alert_state = 'OPTIMAL'
                    conf = np.random.uniform(85, 95)
                    cog_load_class = 1 # Moderate Load

            # 2. Eye channel details
            left_ear = np.random.uniform(0.24, 0.32) if cog_load_class < 3 else np.random.uniform(0.16, 0.23)
            right_ear = left_ear + np.random.uniform(-0.02, 0.02)
            combined_ear = (left_ear + right_ear) / 2
            
            blink_dur = np.random.uniform(150, 320) if cog_load_class < 3 else np.random.uniform(380, 580)
            microsleep = 1 if (cog_load_class == 3 and np.random.rand() > 0.4) else 0
            partial_blink = int(np.random.poisson(1.5))
            double_blink = int(np.random.poisson(0.8))
            saccade_vel = np.random.uniform(100, 300) if cog_load_class < 2 else np.random.uniform(320, 500)
            fixation_density = np.random.uniform(4.0, 7.5) if cog_load_class < 3 else np.random.uniform(1.5, 3.8)
            blink_recovery = np.random.uniform(0.2, 0.8) if cog_load_class < 3 else np.random.uniform(1.8, 3.2)
            
            # 3. Emotiv EEG Wave Bands (μV) and Performance Metrics
            if cog_load_class == 0: # Low
                delta, theta, alpha, beta, gamma = 12.0, 7.0, 22.0, 11.0, 4.0
                eeg_workload, eeg_attention, eeg_fatigue, eeg_engagement = 22.0, 55.0, 15.0, 42.0
            elif cog_load_class == 1: # Moderate
                delta, theta, alpha, beta, gamma = 14.0, 8.5, 16.0, 17.0, 6.0
                eeg_workload, eeg_attention, eeg_fatigue, eeg_engagement = 45.0, 70.0, 32.0, 60.0
            elif cog_load_class == 2: # High
                delta, theta, alpha, beta, gamma = 18.0, 11.0, 10.0, 26.0, 10.0
                eeg_workload, eeg_attention, eeg_fatigue, eeg_engagement = 78.0, 88.0, 48.0, 78.0
            else: # Shock (Class 3)
                delta, theta, alpha, beta, gamma = 28.0, 16.0, 6.0, 33.0, 14.0
                eeg_workload, eeg_attention, eeg_fatigue, eeg_engagement = 92.0, 38.0, 75.0, 85.0
            
            # Add noise to signals
            delta += np.random.normal(0, 1.5)
            theta += np.random.normal(0, 0.8)
            alpha += np.random.normal(0, 1.2)
            beta += np.random.normal(0, 1.8)
            gamma += np.random.normal(0, 0.6)
            
            eeg_workload = max(0, min(100, eeg_workload + np.random.normal(0, 4)))
            eeg_attention = max(0, min(100, eeg_attention + np.random.normal(0, 3)))
            eeg_fatigue = max(0, min(100, eeg_fatigue + np.random.normal(0, 3)))
            eeg_engagement = max(0, min(100, eeg_engagement + np.random.normal(0, 4)))
            eeg_meditation = max(0, min(100, 100 - eeg_workload + np.random.normal(0, 5)))
            eeg_coherence = max(0, min(100, 65 + np.random.normal(0, 6)))

            row = {
                'Session': session_id,
                'Timestamp': ts,
                'Timestamp_ISO': dt_iso,
                'Blink_Rate_perMin': round(br, 1),
                'Gaze_Stability_pct': round(gs, 1),
                'Attention_Score_pct': round(at, 1),
                'Eye_Closure_PERCLOS_pct': round(ec, 1),
                'Total_Blinks': tb,
                'IBI_Avg_ms': round(ibi, 1),
                'Fatigue_Index': round(fatigue, 1),
                'Alert_State': alert_state,
                'Algo_Confidence_pct': round(conf, 1),
                'subject_id': subject_id,
                'test_mode': mode,
                'left_ear': round(left_ear, 3),
                'right_ear': round(right_ear, 3),
                'combined_ear': round(combined_ear, 3),
                'blink_duration_ms': round(blink_dur, 1),
                'microsleep_detected': microsleep,
                'partial_blink_count': partial_blink,
                'double_blink_count': double_blink,
                'saccade_velocity': round(saccade_vel, 2),
                'fixation_density': round(fixation_density, 2),
                'blink_recovery_time_sec': round(blink_recovery, 2),
                'neural_source': 'EEG HARDWARE',
                'neural_attention': round(eeg_attention, 1),
                'neural_meditation': round(eeg_meditation, 1),
                'neural_workload': round(eeg_workload, 1),
                'neural_fatigue': round(eeg_fatigue, 1),
                'neural_engagement': round(eeg_engagement, 1),
                'neural_coherence': round(eeg_coherence, 1),
                'neural_cognitive_load': round((eeg_workload * 0.4 + eeg_fatigue * 0.3 + (100 - eeg_attention) * 0.3), 1),
                'eeg_delta': round(delta, 2),
                'eeg_theta': round(theta, 2),
                'eeg_alpha': round(alpha, 2),
                'eeg_beta': round(beta, 2),
                'eeg_gamma': round(gamma, 2),
                'cognitive_load_label': cog_load_class  # Target Label
            }
            data_rows.append(row)
            
    df = pd.DataFrame(data_rows)
    df.to_csv(filepath, index=False)
    print(f">>> Combined dataset exported successfully to: {filepath} ({len(df)} rows)")
    return df

# ==========================================
# PHASE 2: PREPROCESS DATA & SEQUENCING
# ==========================================
def preprocess_and_sequence(df, seq_len=5):
    """
    Normalizes features and reshapes dataset into (samples, seq_len, num_features)
    to feed into the LSTM network.
    """
    # Define our feature vector (17 dimensions)
    # 6 eye-tracking features + 5 EEG wave bands + 6 EEG cognitive metrics
    features = [
        'combined_ear', 'Blink_Rate_perMin', 'Eye_Closure_PERCLOS_pct', 
        'blink_duration_ms', 'saccade_velocity', 'fixation_density',
        'eeg_delta', 'eeg_theta', 'eeg_alpha', 'eeg_beta', 'eeg_gamma',
        'neural_attention', 'neural_meditation', 'neural_workload', 
        'neural_fatigue', 'neural_engagement', 'neural_coherence'
    ]
    
    X_seq, y_seq = [], []
    
    # Scale features globally
    scaler = StandardScaler()
    df[features] = scaler.fit_transform(df[features])
    
    # Group by sessions so sequence windows don't spill across subjects/sessions
    for name, group in df.groupby('Session'):
        group = group.sort_values('Timestamp')
        X_val = group[features].values
        y_val = group['cognitive_load_label'].values
        
        # Create sliding window sequences
        for i in range(len(group) - seq_len + 1):
            X_seq.append(X_val[i : i + seq_len])
            # Target is the label of the final timestep in the sequence window
            y_seq.append(y_val[i + seq_len - 1])
            
    return np.array(X_seq), np.array(y_seq), features, scaler

# ==========================================
# PHASE 3: DEFINE 2-LAYER LSTM NETWORK
# ==========================================
class CognitiveLoadLSTM(nn.Module):
    def __init__(self, input_dim, hidden_dim, num_classes=4, num_layers=2):
        super(CognitiveLoadLSTM, self).__init__()
        self.num_layers = num_layers
        self.hidden_dim = hidden_dim
        
        # 2-layer LSTM
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0.0
        )
        
        # Fully connected output classifier
        self.fc = nn.Linear(hidden_dim, num_classes)
        
    def forward(self, x):
        # Initialize hidden and cell states
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).to(x.device)
        
        # LSTM forward pass
        out, (hn, cn) = self.lstm(x, (h0, c0))
        
        # We classify based on the output of the last step in the sequence
        out = self.fc(out[:, -1, :])
        return out

# ==========================================
# MAIN EXECUTION ROUTINE
# ==========================================
def main():
    csv_path = "combined_cognitive_dataset.csv"
    
    # 1. Sourcing data
    if not os.path.exists(csv_path):
        df = generate_combined_dataset(csv_path)
    else:
        print(f">>> Found existing dataset at: {csv_path}")
        df = pd.read_csv(csv_path)
        
    # 2. Sequencing data
    seq_len = 5 # 5 timesteps * 8.2s = ~41 seconds sequence length
    X, y, feature_list, scaler = preprocess_and_sequence(df, seq_len=seq_len)
    print(f"Features loaded ({len(feature_list)} dim): {feature_list}")
    print(f"Constructed sequential matrix. Input Shape: {X.shape}, Target Shape: {y.shape}")
    
    # 3. Train-test split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    # Convert numpy arrays to PyTorch Tensors
    train_dataset = TensorDataset(torch.FloatTensor(X_train), torch.LongTensor(y_train))
    test_dataset = TensorDataset(torch.FloatTensor(X_test), torch.LongTensor(y_test))
    
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)
    
    # 4. Initialize model, optimizer, loss
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    input_dim = len(feature_list)
    hidden_dim = 64
    num_classes = 4
    
    model = CognitiveLoadLSTM(input_dim=input_dim, hidden_dim=hidden_dim, num_classes=num_classes, num_layers=2)
    model.to(device)
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.002, weight_decay=1e-4)
    
    print("\n" + "="*45)
    print(f" TRAINING 2-LAYER LSTM ON DEVICE: {device}")
    print("="*45)
    
    # 5. Training Loop
    epochs = 20
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        correct = 0
        total = 0
        
        for batch_x, batch_y in train_loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            
            optimizer.zero_grad()
            outputs = model(batch_x)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item() * batch_x.size(0)
            _, predicted = torch.max(outputs, 1)
            total += batch_y.size(0)
            correct += (predicted == batch_y).sum().item()
            
        epoch_loss = train_loss / len(train_loader.dataset)
        epoch_acc = (correct / total) * 100
        
        # Print logs every 4 epochs
        if epoch == 1 or epoch % 4 == 0 or epoch == epochs:
            print(f"Epoch {epoch:02d}/{epochs:02d} | Train Loss: {epoch_loss:.4f} | Train Acc: {epoch_acc:.2f}%")
            
    # 6. Evaluation Loop
    model.eval()
    test_loss = 0.0
    correct = 0
    total = 0
    all_preds = []
    all_targets = []
    
    with torch.no_grad():
        for batch_x, batch_y in test_loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            outputs = model(batch_x)
            loss = criterion(outputs, batch_y)
            
            test_loss += loss.item() * batch_x.size(0)
            _, predicted = torch.max(outputs, 1)
            total += batch_y.size(0)
            correct += (predicted == batch_y).sum().item()
            
            all_preds.extend(predicted.cpu().numpy())
            all_targets.extend(batch_y.cpu().numpy())
            
    test_acc = (correct / total) * 100
    print("\n" + "="*45)
    print(f" EVALUATION RESULTS")
    print(f" Test Accuracy: {test_acc:.2f}% | Average Loss: {test_loss / len(test_loader.dataset):.4f}")
    print("="*45)
    
    # 7. Real-Time Inference Demo
    print("\n>>> Simulating Live Inference Session...")
    # Generate a single raw input sequence representing a "Cognitive Shock" transition
    # (High PERCLOS, sudden drop in attention, spikes in theta/beta EEG bands)
    raw_sequence = [
        # timestep 1 (still optimal)
        [0.28, 14.0, 8.0, 210.0, 180.0, 5.5, 12.5, 7.8, 20.0, 13.0, 5.0, 72.0, 48.0, 38.0, 22.0, 50.0, 68.0],
        # timestep 2 (increasing workload)
        [0.26, 17.0, 12.0, 230.0, 220.0, 4.8, 14.0, 9.2, 17.0, 16.0, 6.2, 75.0, 42.0, 48.0, 30.0, 55.0, 66.0],
        # timestep 3 (AI Disconnects - Shock begins)
        [0.21, 26.0, 22.0, 410.0, 340.0, 3.1, 24.0, 13.0, 8.2, 28.0, 10.5, 52.0, 35.0, 82.0, 62.0, 75.0, 65.0],
        # timestep 4 (Peak Shock state)
        [0.18, 34.0, 32.0, 520.0, 420.0, 2.0, 29.5, 15.2, 5.5, 34.5, 13.2, 36.0, 28.0, 93.0, 78.0, 86.0, 63.0],
        # timestep 5 (High fatigue, long blink recovery)
        [0.17, 36.0, 35.0, 550.0, 440.0, 1.8, 28.0, 16.5, 6.2, 32.0, 14.2, 39.0, 29.0, 90.0, 80.0, 84.0, 64.0]
    ]
    
    # Scale test sequence features using the fitted scaler (wrapped in DataFrame to avoid warning)
    test_df = pd.DataFrame(raw_sequence, columns=feature_list)
    scaled_sequence = scaler.transform(test_df)
    
    # Reshape to (batch_size=1, seq_len=5, num_features=17)
    input_tensor = torch.FloatTensor(scaled_sequence).unsqueeze(0).to(device)
    
    # Get model prediction
    model.eval()
    with torch.no_grad():
        logits = model(input_tensor)
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
        pred_class = np.argmax(probs)
        
    class_labels = ["Low Load (Relaxed)", "Moderate Load (Optimal Focus)", "High Load (Elevated Stress)", "Cognitive Shock"]
    
    print("\n-------------------------------------------")
    print(" LIVE TELEMETRY DECODING (Last 41 Seconds)")
    print("-------------------------------------------")
    for i, label in enumerate(class_labels):
        indicator = "==>" if i == pred_class else "   "
        print(f"{indicator} {label:<32} : {probs[i]*100:>6.2f}% confidence")
    print("-------------------------------------------")
    print(f"DECISION: System outputs final state: {class_labels[pred_class].upper()}")
    print("-------------------------------------------\n")

if __name__ == "__main__":
    main()
