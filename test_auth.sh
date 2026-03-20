#!/bin/bash

echo "Starting NestJS app..."
npm run start > /dev/null 2>&1 &
APP_PID=$!

sleep 10

echo "Testing /auth/profile without token (expect 401)..."
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/auth/profile
echo ""

echo "Logging in as john..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3001/auth/login \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "username=john&password=changeme")

echo "Login response: $LOGIN_RESPONSE"

TOKEN=$(echo $LOGIN_RESPONSE | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
    echo "Failed to get token"
else
    echo "Testing /auth/profile with token (expect 200)..."
    curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/auth/profile
    echo ""
fi

echo "Cleaning up..."
kill $APP_PID
