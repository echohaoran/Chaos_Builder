#!/bin/bash
# Start frontend static file server
cd "$(dirname "$0")/frontend"
echo "Frontend starting on http://localhost:8080"
python3 -m http.server 8080
