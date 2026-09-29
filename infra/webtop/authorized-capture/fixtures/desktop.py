import sys
from PyQt6.QtWidgets import QApplication, QWidget, QLineEdit
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

QTimer.singleShot(1500, record)
sys.exit(app.exec())
