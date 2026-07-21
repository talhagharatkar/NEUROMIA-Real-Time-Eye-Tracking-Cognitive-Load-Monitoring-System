import cv2
import numpy as np
import plotly.graph_objects as go
import webbrowser
import tempfile

# ---------------------------
# 🧠 3D Brain (Ellipsoid Model)
# ---------------------------
phi, theta = np.mgrid[0:np.pi:60j, 0:2*np.pi:60j]

x = 1.2 * np.sin(phi) * np.cos(theta)
y = 1.0 * np.sin(phi) * np.sin(theta)
z = 1.4 * np.cos(phi)

# ---------------------------
# 👁️ Eye Blink Detection (Simple OpenCV)
# ---------------------------
eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

cap = cv2.VideoCapture(0)

blink_count = 0
eye_closed_frames = 0

print("Press ESC to exit")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    faces = face_cascade.detectMultiScale(gray, 1.3, 5)

    eyes_detected = False

    for (x1, y1, w, h) in faces:
        roi_gray = gray[y1:y1+h, x1:x1+w]
        eyes = eye_cascade.detectMultiScale(roi_gray)

        if len(eyes) > 0:
            eyes_detected = True

    # Blink logic
    if not eyes_detected:
        eye_closed_frames += 1
    else:
        if eye_closed_frames > 2:
            blink_count += 1
            print(f"Blink Detected! Total: {blink_count}")
        eye_closed_frames = 0

    # Show webcam
    cv2.putText(frame, f"Blinks: {blink_count}", (20, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

    cv2.imshow("Eye Blink Detection", frame)

    # ---------------------------
    # 🧠 Generate 3D Brain (HTML)
    # ---------------------------
    fig = go.Figure()

    fig.add_trace(go.Surface(
        x=x, y=y, z=z,
        colorscale='Pink',
        opacity=0.9
    ))

    # Highlight when blink
    if blink_count % 2 == 1:
        fig.add_trace(go.Scatter3d(
            x=[0], y=[0], z=[1.5],
            mode='markers',
            marker=dict(size=10, color='yellow'),
            name='Blink Activity'
        ))

    fig.update_layout(
        title=f"3D Brain | Blinks: {blink_count}",
        scene=dict(
            xaxis_title='X',
            yaxis_title='Y',
            zaxis_title='Z'
        )
    )

    # Save temp HTML and open
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".html")
    fig.write_html(temp_file.name)

    webbrowser.open(temp_file.name)

    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()