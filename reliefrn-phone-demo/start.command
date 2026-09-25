#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
python -c 'import sys; sys.exit("Python 3.10 or newer is required.") if sys.version_info < (3, 10) else None'
python -m pip install -r requirements.txt --quiet
exec python app.py "$@"
