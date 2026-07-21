import unittest
import numpy as np

class BlinkStateMachine:
    def __init__(self, threshold_calibrated=0.25):
        self.threshold = threshold_calibrated
        self.blink_count = 0
        self.slow_blink_count = 0
        self.extended_closure_count = 0
        
        # State tracking variables
        self.left_closed_time = None
        self.right_closed_time = None
        self.in_closure = False
        self.closure_start_time = None
        self.closure_rejected = False
        
        # Cooldown / Refractory period tracking
        self.last_reopen_time = None
        self.open_frames_since_reopen = 0
        
        # Head pose suspension flag
        self.pose_suspended = False
        
        # Landmark / EAR trace collection for monotonic shape validation
        self.ear_trace = []  # List of floats (average EAR during closure)
        
        # Log of events for debug
        self.last_event = "WAITING"
        self.last_duration = 0.0

    def update(self, ear_l, ear_r, yaw, pitch, timestamp_ms):
        """
        Update the state machine with the current frame data.
        yaw and pitch should be in degrees.
        timestamp_ms should be the current frame timestamp in milliseconds.
        Returns a dict of current status.
        """
        # Gating Check: Suspend blink detection while head yaw or pitch exceeds 15 degrees
        head_pose_exceeded = abs(yaw) > 15.0 or abs(pitch) > 15.0
        if head_pose_exceeded:
            self.pose_suspended = True
        
        ear_avg = (ear_l + ear_r) / 2.0
        left_closed = ear_l < self.threshold
        right_closed = ear_r < self.threshold
        both_closed = left_closed and right_closed
        both_open = not left_closed and not right_closed

        # Track when each eye closes
        if left_closed and self.left_closed_time is None:
            self.left_closed_time = timestamp_ms
        elif not left_closed:
            self.left_closed_time = None
            
        if right_closed and self.right_closed_time is None:
            self.right_closed_time = timestamp_ms
        elif not right_closed:
            self.right_closed_time = None

        # State transition logic
        if not self.in_closure:
            # Check if both eyes are closed to start a closure event
            if both_closed:
                # Both eyes must cross threshold within 40ms of each other
                time_diff = abs(self.left_closed_time - self.right_closed_time)
                
                # Check if refractory period is satisfied:
                # must stay open >= 150ms AND for >= 3 consecutive frames
                refractory_satisfied = True
                if self.last_reopen_time is not None:
                    time_open = timestamp_ms - self.last_reopen_time
                    if time_open < 150.0 or self.open_frames_since_reopen < 3:
                        refractory_satisfied = False

                self.in_closure = True
                self.closure_start_time = max(self.left_closed_time, self.right_closed_time)
                self.ear_trace = [ear_avg]
                
                # Apply initial rejection rules
                if time_diff > 40.0:
                    self.closure_rejected = True
                    self.last_event = "REJECTED_ASYNCHRONOUS_CLOSURE"
                elif not refractory_satisfied:
                    self.closure_rejected = True
                    self.last_event = "REJECTED_REFRACTORY_VIOLATION"
                else:
                    self.closure_rejected = False
                    self.pose_suspended = head_pose_exceeded
                    self.last_event = "CLOSURE_ACTIVE"
            else:
                # If only one eye closed, verify it's not a wink to be logged
                if (left_closed and not right_closed) or (right_closed and not left_closed):
                    self.last_event = "WINK_OR_SINGLE_EYE_CLOSURE"
                else:
                    self.last_event = "WAITING"
        else:
            # We are currently in a closure event
            self.ear_trace.append(ear_avg)
            if head_pose_exceeded:
                self.pose_suspended = True

            # Check if closure has ended (either eye reopens)
            if not both_closed:
                self.in_closure = False
                duration = timestamp_ms - self.closure_start_time
                self.last_duration = duration
                
                # Record reopen tracking
                self.last_reopen_time = timestamp_ms
                self.open_frames_since_reopen = 0

                if self.closure_rejected:
                    # Already marked as rejected during start
                    pass
                elif self.pose_suspended:
                    self.last_event = "REJECTED_POSE_EXCEEDED"
                else:
                    # Verify monotonic shape: open -> closing -> minimum -> opening
                    is_monotonic = self._check_monotonic_shape(self.ear_trace)
                    if not is_monotonic:
                        self.last_event = "REJECTED_NON_MONOTONIC"
                    else:
                        # Duration classification
                        if duration < 100.0:
                            self.last_event = "DISCARDED_NOISE"
                        elif 100.0 <= duration <= 400.0:
                            self.blink_count += 1
                            self.last_event = "VALID_NATURAL_BLINK"
                        elif 401.0 <= duration <= 500.0:
                            self.blink_count += 1
                            self.slow_blink_count += 1
                            self.last_event = "VALID_SLOW_BLINK"
                        else: # > 500ms
                            self.extended_closure_count += 1
                            self.last_event = "EXTENDED_CLOSURE_EVENT"
                
                # Reset temp trackers
                self.pose_suspended = False
                self.closure_rejected = False

        # Update open trackers at the end of the update
        if both_open:
            if self.last_reopen_time is not None:
                self.open_frames_since_reopen += 1

        return {
            "blink_count": self.blink_count,
            "slow_blink_count": self.slow_blink_count,
            "extended_closure_count": self.extended_closure_count,
            "last_event": self.last_event,
            "last_duration_ms": self.last_duration,
            "in_closure": self.in_closure
        }

    def _check_monotonic_shape(self, trace):
        """
        Verify that the EAR trace follows: open -> closing -> minimum -> opening.
        The values should generally decrease to a minimum, and then increase.
        Allows a small tolerance for high-frequency sub-pixel noise.
        """
        if len(trace) < 3:
            return True # Too few frames to perform reliable shape check, assume valid
            
        min_idx = int(np.argmin(trace))
        
        # Tolerance for fluctuations
        tolerance = 0.015
        
        # 1. Closing phase: from index 0 to min_idx, values should be non-increasing
        for i in range(min_idx):
            if trace[i+1] - trace[i] > tolerance:
                return False
                
        # 2. Opening phase: from min_idx to the end, values should be non-decreasing
        for i in range(min_idx, len(trace) - 1):
            if trace[i] - trace[i+1] > tolerance:
                return False
                
        return True


# ── UNIT TEST SUITE ──
class TestBlinkStateMachine(unittest.TestCase):
    def setUp(self):
        self.sm = BlinkStateMachine(threshold_calibrated=0.25)
        
    def test_valid_natural_blink(self):
        """
        Valid natural blink: symmetric V-shape, 200ms duration, satisfying refractory period.
        """
        # Ensure eyes open initially to satisfy refractory period (3 frames open)
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3) # 33.3ms steps (30fps)
            
        # Start blink at t = 100ms
        self.sm.update(0.12, 0.12, 0.0, 0.0, 100.0) # both closed
        self.sm.update(0.08, 0.08, 0.0, 0.0, 133.3) # going down
        self.sm.update(0.05, 0.05, 0.0, 0.0, 166.7) # minimum
        self.sm.update(0.10, 0.10, 0.0, 0.0, 200.0) # going up
        self.sm.update(0.18, 0.18, 0.0, 0.0, 233.3) # going up
        
        # Reopen at t = 300ms (duration = 200ms)
        res = self.sm.update(0.32, 0.32, 0.0, 0.0, 300.0)
        
        self.assertEqual(res["blink_count"], 1)
        self.assertEqual(res["slow_blink_count"], 0)
        self.assertEqual(res["last_event"], "VALID_NATURAL_BLINK")
        self.assertEqual(res["last_duration_ms"], 200.0)

    def test_valid_slow_blink(self):
        """
        Valid slow blink: 450ms duration, flagged slow_blink = true but still counted.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Start closure
        self.sm.update(0.10, 0.10, 0.0, 0.0, 100.0)
        # Hold closed
        self.sm.update(0.06, 0.06, 0.0, 0.0, 250.0)
        self.sm.update(0.05, 0.05, 0.0, 0.0, 400.0)
        # Reopen at t = 550ms (duration = 450ms)
        res = self.sm.update(0.30, 0.30, 0.0, 0.0, 550.0)
        
        self.assertEqual(res["blink_count"], 1)
        self.assertEqual(res["slow_blink_count"], 1)
        self.assertEqual(res["last_event"], "VALID_SLOW_BLINK")
        self.assertEqual(res["last_duration_ms"], 450.0)

    def test_noise_discard(self):
        """
        Duration < 100ms: discard as noise/jitter.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Start closure
        self.sm.update(0.10, 0.10, 0.0, 0.0, 100.0)
        # Reopen at t = 160ms (duration = 60ms)
        res = self.sm.update(0.32, 0.32, 0.0, 0.0, 160.0)
        
        self.assertEqual(res["blink_count"], 0)
        self.assertEqual(res["last_event"], "DISCARDED_NOISE")

    def test_extended_closure(self):
        """
        Duration > 500ms: NOT a blink, log separately as extended_closure.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Start closure
        self.sm.update(0.10, 0.10, 0.0, 0.0, 100.0)
        self.sm.update(0.06, 0.06, 0.0, 0.0, 300.0)
        self.sm.update(0.05, 0.05, 0.0, 0.0, 500.0)
        # Reopen at t = 650ms (duration = 550ms)
        res = self.sm.update(0.32, 0.32, 0.0, 0.0, 650.0)
        
        self.assertEqual(res["blink_count"], 0)
        self.assertEqual(res["extended_closure_count"], 1)
        self.assertEqual(res["last_event"], "EXTENDED_CLOSURE_EVENT")

    def test_wink_rejection(self):
        """
        Wink rejection: single-eye closure.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Only left eye closed, right eye open
        res1 = self.sm.update(0.10, 0.35, 0.0, 0.0, 100.0)
        self.assertEqual(res1["last_event"], "WINK_OR_SINGLE_EYE_CLOSURE")
        self.assertEqual(res1["blink_count"], 0)

    def test_asynchronous_closure_rejection(self):
        """
        Eyes crossing threshold >40ms apart: reject as tracking artifact.
        """
        # Left eye closes at t=100ms
        self.sm.update(0.10, 0.35, 0.0, 0.0, 100.0)
        # Right eye closes at t=150ms (50ms difference > 40ms)
        self.sm.update(0.10, 0.10, 0.0, 0.0, 150.0)
        # Keep closed
        self.sm.update(0.08, 0.08, 0.0, 0.0, 200.0)
        # Reopen
        res = self.sm.update(0.35, 0.35, 0.0, 0.0, 350.0)
        
        self.assertEqual(res["blink_count"], 0)
        self.assertEqual(res["last_event"], "REJECTED_ASYNCHRONOUS_CLOSURE")

    def test_refractory_period_violation(self):
        """
        Eyes must stay open >=150ms and >=3 consecutive frames.
        """
        # 1st Valid Blink
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
        self.sm.update(0.10, 0.10, 0.0, 0.0, 100.0)
        self.sm.update(0.35, 0.35, 0.0, 0.0, 300.0) # Blink 1 accepted (dur=200ms)
        
        # Eyes open for only 1 frame, then close again (duration since reopen = 33.3ms, frames = 1)
        self.sm.update(0.35, 0.35, 0.0, 0.0, 333.3)
        self.sm.update(0.10, 0.10, 0.0, 0.0, 366.6)
        res = self.sm.update(0.35, 0.35, 0.0, 0.0, 500.0)
        
        # Should reject second blink due to refractory period violation
        self.assertEqual(res["blink_count"], 1) # count remains 1
        self.assertEqual(res["last_event"], "REJECTED_REFRACTORY_VIOLATION")

    def test_head_pose_suspension(self):
        """
        Suspend blink detection while yaw or pitch > 15 degrees.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Close eyes with yaw = 18 degrees
        self.sm.update(0.10, 0.10, 18.0, 0.0, 100.0)
        self.sm.update(0.06, 0.06, 18.0, 0.0, 200.0)
        res = self.sm.update(0.35, 0.35, 18.0, 0.0, 300.0)
        
        self.assertEqual(res["blink_count"], 0)
        self.assertEqual(res["last_event"], "REJECTED_POSE_EXCEEDED")

    def test_non_monotonic_trace_rejection(self):
        """
        Blink shape must follow open -> closing -> minimum -> opening; reject non-monotonic traces.
        """
        for i in range(3):
            self.sm.update(0.35, 0.35, 0.0, 0.0, i * 33.3)
            
        # Start closure
        self.sm.update(0.12, 0.12, 0.0, 0.0, 100.0)
        self.sm.update(0.08, 0.08, 0.0, 0.0, 133.3) # going down
        self.sm.update(0.16, 0.16, 0.0, 0.0, 166.7) # WRONG: going UP during closing! (non-monotonic)
        self.sm.update(0.05, 0.05, 0.0, 0.0, 200.0) # minimum
        self.sm.update(0.15, 0.15, 0.0, 0.0, 233.3) # going up
        res = self.sm.update(0.35, 0.35, 0.0, 0.0, 300.0)
        
        self.assertEqual(res["blink_count"], 0)
        self.assertEqual(res["last_event"], "REJECTED_NON_MONOTONIC")

if __name__ == '__main__':
    unittest.main()
