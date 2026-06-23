#!/bin/bash
# Start frontend dev server
cd "$(dirname "$0")/../frontend"
echo "Frontend starting on http://localhost:8080"
python3 dev-server.py 8080