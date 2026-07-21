#!/usr/bin/env python
"""
NEUROMIA EEG Gateway Script (emotiv_gateway.py)
-----------------------------------------------
Runs on PC B to receive EEG stream from the Emotiv headset and broadcast
it via a WebSocket server to the PC A dashboard (efg.html) on port 8765.

Supports:
1. --simulate: Simulates EEG waves and cognitive load metrics (default if Emotiv credentials are missing).
2. Cortex API Mode: Connects to Emotiv App (via wss://localhost:6868) using Client ID/Secret.

Dependencies:
    pip install websockets asyncio

Usage:
    python emotiv_gateway.py --simulate
    python emotiv_gateway.py --client-id YOUR_ID --client-secret YOUR_SECRET
"""

import asyncio
import json
import math
import random
import sys
import time
import argparse
from websockets.server import serve
import websockets

# Constants
DEFAULT_PORT = 8765
CORTEX_URL = "wss://localhost:6868"

# Global set of connected dashboard clients
connected_clients = set()

# Simulated data state
sim_tick = 0

def generate_simulated_data():
    """Generates realistic varying EEG waves and cognitive metrics."""
    global sim_tick
    sim_tick += 1
    
    # Use overlapping sine waves to simulate physiological oscillations
    base_attention = 50 + 20 * math.sin(sim_tick * 0.05) + 10 * math.sin(sim_tick * 0.13)
    base_workload = 45 + 15 * math.cos(sim_tick * 0.04) + 12 * math.sin(sim_tick * 0.09)
    base_fatigue = 30 + 10 * math.sin(sim_tick * 0.02) + 5 * math.cos(sim_tick * 0.07)
    base_engagement = 55 + 15 * math.sin(sim_tick * 0.06)
    base_meditation = 40 + 20 * math.cos(sim_tick * 0.03)
    
    # Add minor random noise
    attention = max(0.0, min(100.0, base_attention + random.uniform(-3, 3)))
    workload = max(0.0, min(100.0, base_workload + random.uniform(-2, 2)))
    fatigue = max(0.0, min(100.0, base_fatigue + random.uniform(-2, 2)))
    engagement = max(0.0, min(100.0, base_engagement + random.uniform(-3, 3)))
    meditation = max(0.0, min(100.0, base_meditation + random.uniform(-4, 4)))
    coherence = max(0.0, min(100.0, 70.0 + 10 * math.sin(sim_tick * 0.08) + random.uniform(-5, 5)))
    
    # EEG wave bands in microvolts (µV)
    # Delta (1-4 Hz): Deep sleep, high when fatigued or blinking
    delta = 15.0 + 8.0 * math.sin(sim_tick * 0.03) + random.uniform(0, 3)
    # Theta (4-8 Hz): Drowsiness, mental effort
    theta = 8.0 + 4.0 * math.sin(sim_tick * 0.05) + random.uniform(0, 2)
    # Alpha (8-12 Hz): Relaxation, eyes closed
    alpha = 12.0 + 6.0 * math.cos(sim_tick * 0.04) + random.uniform(0, 2)
    # Beta (12-30 Hz): Active thinking, focus
    beta = 18.0 + 10.0 * math.sin(sim_tick * 0.07) + random.uniform(0, 4)
    # Gamma (30-100 Hz): High cognitive processing, integration
    gamma = 6.0 + 3.0 * math.sin(sim_tick * 0.1) + random.uniform(0, 1)

    packet = {
        "waves": {
            "delta": round(delta, 2),
            "theta": round(theta, 2),
            "alpha": round(alpha, 2),
            "beta": round(beta, 2),
            "gamma": round(gamma, 2)
        },
        "metrics": {
            "attention": round(attention, 1),
            "meditation": round(meditation, 1),
            "workload": round(workload, 1),
            "fatigue": round(fatigue, 1),
            "engagement": round(engagement, 1),
            "coherence": round(coherence, 1)
        }
    }
    return packet

async def broadcast_data(data):
    """Sends the JSON data package to all connected dashboard clients."""
    if not connected_clients:
        return
    message = json.dumps(data)
    # Create a copy of the set to avoid modification during iteration
    clients = list(connected_clients)
    for ws in clients:
        try:
            await ws.send(message)
        except Exception:
            connected_clients.remove(ws)

async def simulation_loop():
    """Infinite loop generating and broadcasting simulated EEG data."""
    print(">>> Starting Gateway in SIMULATION Mode...")
    print(">>> Generating synthetic 14-channel EEG bands & metrics...")
    while True:
        packet = generate_simulated_data()
        await broadcast_data(packet)
        await asyncio.sleep(0.7)  # Match dashboard's refresh interval (700ms)

class CortexGateway:
    """Handles connection to Emotiv Cortex API and converts data to NEUROMIA formats."""
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.auth_token = None
        self.session_id = None
        self.websocket = None
        self.req_id = 0
        
        # Buffer to keep track of the latest bandpower ('pow') and performance metrics ('met')
        self.latest_pow = {"delta": 0.0, "theta": 0.0, "alpha": 0.0, "beta": 0.0, "gamma": 0.0}
        # Emotiv metrics are: [interest, stress, relaxation, excitement, engagement, focus]
        # We map focus -> attention, stress -> workload, relaxation -> meditation, engagement -> engagement
        self.latest_met = {"attention": 50.0, "meditation": 50.0, "workload": 50.0, "fatigue": 20.0, "engagement": 50.0, "coherence": 50.0}

    async def call_api(self, method, params=None):
        self.req_id += 1
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.req_id
        }
        if params:
            payload["params"] = params
        
        await self.websocket.send(json.dumps(payload))
        response = await self.websocket.recv()
        return json.loads(response)

    async def connect_and_subscribe(self):
        print(f"Connecting to Cortex Service at {CORTEX_URL}...")
        # Self-signed certs are commonly used by Emotiv service locally, disable verification
        self.websocket = await websockets.connect(CORTEX_URL, ssl=False)
        
        # 1. Authorize
        print("Authorizing client credentials...")
        auth_resp = await self.call_api("authorize", {
            "clientId": self.client_id,
            "clientSecret": self.client_secret
        })
        if "error" in auth_resp:
            raise Exception(f"Authentication failed: {auth_resp['error']['message']}")
        
        self.auth_token = auth_resp["result"]["cortexToken"]
        
        # 2. Query Headset
        print("Querying connected Emotiv headsets...")
        hs_resp = await self.call_api("queryHeadsets")
        headsets = hs_resp.get("result", [])
        if not headsets:
            raise Exception("No Emotiv headsets found. Make sure your headset is powered on and connected via USB/Bluetooth.")
        
        headset_id = headsets[0]["id"]
        print(f"Found headset: {headset_id} ({headsets[0]['status']})")
        
        # 3. Create Session
        print(f"Creating recording session for {headset_id}...")
        sess_resp = await self.call_api("createSession", {
            "cortexToken": self.auth_token,
            "headset": headset_id,
            "status": "open"
        })
        if "error" in sess_resp:
            raise Exception(f"Failed to create session: {sess_resp['error']['message']}")
            
        self.session_id = sess_resp["result"]["id"]
        print(f"Session {self.session_id} created successfully.")
        
        # 4. Subscribe to streams
        # 'pow': bandpower of channels (Theta, Alpha, BetaL, BetaH, Gamma)
        # 'met': performance metrics (focus, stress, interest, relaxation, excitement, engagement)
        print("Subscribing to Bandpower (pow) and Performance Metrics (met) streams...")
        sub_resp = await self.call_api("subscribe", {
            "cortexToken": self.auth_token,
            "session": self.session_id,
            "streams": ["pow", "met"]
        })
        if "error" in sub_resp:
            raise Exception(f"Subscription failed: {sub_resp['error']['message']}")
        
        print("EEG subscription complete! Siphoning live data streams...")

    async def run_loop(self):
        """Processes incoming Cortex stream packets and broadcasts them."""
        # Mapping of bandpower positions in Emotiv 'pow' stream
        # Order in pow array: Theta, Alpha, BetaL, BetaH, Gamma for each channel
        # Channels (14 channels): AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4, F8, AF4
        # We average across all active channels to yield global bands
        while True:
            try:
                msg = await self.websocket.recv()
                data = json.loads(msg)
                
                # Check for subscription data
                if "pow" in data:
                    pow_values = data["pow"]  # List of floats
                    # 14 channels * 5 bands = 70 values
                    num_channels = len(pow_values) // 5
                    if num_channels > 0:
                        thetas, alphas, betas, gammas, deltas = [], [], [], [], []
                        for i in range(num_channels):
                            idx = i * 5
                            thetas.append(pow_values[idx])
                            alphas.append(pow_values[idx + 1])
                            # Beta is split into BetaL and BetaH, average them
                            betas.append((pow_values[idx + 2] + pow_values[idx + 3]) / 2.0)
                            gammas.append(pow_values[idx + 4])
                            # Emotiv does not stream delta power by default, we estimate delta from theta/alpha ratio
                            deltas.append(pow_values[idx] * 1.5)
                        
                        self.latest_pow = {
                            "delta": round(sum(deltas) / len(deltas) * 100, 2),  # Scale to match microvolts representation
                            "theta": round(sum(thetas) / len(thetas) * 100, 2),
                            "alpha": round(sum(alphas) / len(alphas) * 100, 2),
                            "beta": round(sum(betas) / len(betas) * 100, 2),
                            "gamma": round(sum(gammas) / len(gammas) * 100, 2),
                        }

                elif "met" in data:
                    met_values = data["met"]
                    # Emotiv Performance Metrics layout:
                    # [0] Interest, [1] Stress, [2] Relaxation, [3] Excitement, [4] Engagement, [5] Cognitive/Mental Focus
                    # Scale to 0-100%
                    self.latest_met = {
                        "attention": round(met_values[5] * 100, 1),
                        "meditation": round(met_values[2] * 100, 1),
                        "workload": round(met_values[1] * 100, 1),
                        "fatigue": round((1.0 - met_values[4]) * 50 + 10, 1), # derived proxy
                        "engagement": round(met_values[4] * 100, 1),
                        "coherence": round(met_values[0] * 100, 1) # interest mapped to coherence visual
                    }
                    
                    # Whenever a new metrics update arrives, broadcast the compiled data
                    packet = {
                        "waves": self.latest_pow,
                        "metrics": self.latest_met
                    }
                    await broadcast_data(packet)

            except Exception as e:
                print(f"Error in Emotiv reader loop: {e}")
                print("Reverting to simulation mode to prevent system crash...")
                await simulation_loop()
                break

async def handler(websocket, path):
    """Handles incoming connection requests from NEUROMIA dashboards."""
    print(f"Dashboard connected from {websocket.remote_address[0]}")
    connected_clients.add(websocket)
    try:
        async for message in websocket:
            # We don't expect messages from client, but keep the connection active
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"Dashboard disconnected: {websocket.remote_address[0]}")
        connected_clients.remove(websocket)

async def main():
    parser = argparse.ArgumentParser(description="NEUROMIA EEG WebSocket Gateway")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to serve WebSocket on")
    parser.add_argument("--simulate", action="store_true", help="Run in simulation mode")
    parser.add_argument("--client-id", type=str, help="Emotiv Cortex Client ID")
    parser.add_argument("--client-secret", type=str, help="Emotiv Cortex Client Secret")
    args = parser.parse_args()

    # Start the local WebSocket server that the HTML dashboard connects to
    print(f"Starting NEUROMIA WebSocket Server on ws://0.0.0.0:{args.port}...")
    server = await serve(handler, "0.0.0.0", args.port)

    # Determine mode
    if args.simulate or not args.client_id or not args.client_secret:
        if not args.simulate:
            print("WARNING: Client ID or Secret missing. Defaulting to Simulation Mode.")
        await simulation_loop()
    else:
        gateway = CortexGateway(args.client_id, args.client_secret)
        try:
            await gateway.connect_and_subscribe()
            await gateway.run_loop()
        except Exception as e:
            print(f"FATAL: Failed to initialize Emotiv Cortex connection: {e}")
            print("Starting simulation mode as fallback so the dashboard can still run...")
            await simulation_loop()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nEEG Gateway terminated by user.")
        sys.exit(0)
