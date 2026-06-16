#!/bin/bash
# Start backend API server
cd "$(dirname "$0")/server"
echo "Backend starting on http://localhost:3001"
node server.js
