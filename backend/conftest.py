"""Make ``backend/`` importable so tests use ``from app... import ...``."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
