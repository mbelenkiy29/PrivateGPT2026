#!/bin/bash

port="${SERVER_PORT:-${PORT:-3001}}"
response=$(curl --write-out '%{http_code}' --silent --output /dev/null "http://localhost:${port}/api/ping")

# If the HTTP response code is 200 (OK), the server is up
if [ "$response" -eq 200 ]; then
  echo "Server is up"
  exit 0
else
  echo "Server is down"
  exit 1
fi
