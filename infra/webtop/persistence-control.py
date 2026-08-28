from pathlib import Path
import sys

from PyQt6.QtWidgets import QApplication, QTextEdit

state_path = Path("/config/workspace/persistence-state.txt")
app = QApplication(sys.argv)
app.setApplicationName("persistence-proof")
editor = QTextEdit()
editor.setAccessibleName("Persistence proof control")
editor.setPlainText(state_path.read_text() if state_path.exists() else "")
editor.textChanged.connect(lambda: state_path.write_text(editor.toPlainText()))
editor.resize(640, 320)
editor.show()
sys.exit(app.exec())
