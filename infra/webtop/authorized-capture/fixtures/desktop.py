import sys
from PyQt6.QtWidgets import QApplication, QWidget, QLineEdit, QLabel
from PyQt6.QtCore import QTimer
from pathlib import Path
import json

app = QApplication(sys.argv)
app.setApplicationName("authorized-capture-fixture")
window = QWidget()
window.setWindowTitle("Synthetic capture fixture")
window.resize(400, 240)
window.move(100, 100)
color = QLineEdit(window)
color.setAccessibleName("Solid capture target")
color.setGeometry(20, 20, 160, 80)
color.setStyleSheet("background: rgb(24, 96, 168); border: none; color: rgb(24, 96, 168)")
color.setReadOnly(True)
password = QLineEdit(window)
password.setAccessibleName("Protected capture target")
password.setEchoMode(QLineEdit.EchoMode.Password)
password.setGeometry(20, 140, 160, 40)
password.setText("synthetic-secret")
window.show()

def record():
    point = color.mapToGlobal(color.rect().topLeft())
    Path("/tmp/authorized-fixture-geometry.json").write_text(json.dumps({"x": point.x(), "y": point.y(), "width": color.width(), "height": color.height()}))

occluder = QLabel(window)
occluder.setStyleSheet("background: rgb(208, 40, 32)")
occluder.hide()
command_path = Path("/tmp/authorized-fixture-command.json")
last_command = None
motion = None
counter = 0

def control():
    global last_command, motion, counter
    if command_path.exists():
        command = json.loads(command_path.read_text())
        if command != last_command:
            last_command = command
            motion = command["mode"] if command["mode"] in ("move", "resize") else None
            window.setFixedSize(400, 240)
            color.setGeometry(20, 20, 160, 80)
            occluder.hide()
            if command["mode"] == "overlap":
                occluder.setGeometry(100, 20, 80, 80)
                occluder.show()
                occluder.raise_()
            elif command["mode"] == "clip":
                window.setFixedSize(1400, 240)
                color.setGeometry(900, 20, 160, 80)
            def acknowledge():
                record()
                Path("/tmp/authorized-fixture-ack.json").write_text(json.dumps(command))
            QTimer.singleShot(400, acknowledge)
    if motion:
        counter += 1
        if motion == "move":
            color.move(20 + counter % 100, 20)
        else:
            color.resize(160 + counter % 100, 80)

control_timer = QTimer()
control_timer.timeout.connect(control)
control_timer.start(5)
QTimer.singleShot(1500, record)
sys.exit(app.exec())
