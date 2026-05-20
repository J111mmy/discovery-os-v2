#!/bin/bash
# Discovery OS v2 — One-command dev startup
# Usage: ./dev.sh
# Starts Next.js on port 3000 + Inngest dev server, both in the same terminal

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PORT=3000
INNGEST_PORT=8288

echo "🧹 Cleaning up any stale processes..."
pkill -f "next dev" 2>/dev/null
pkill -f "inngest" 2>/dev/null
sleep 1

# Free ports if something is still holding them
for port in $APP_PORT $INNGEST_PORT; do
  pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "  Killing process on port $port (PID $pid)"
    kill -9 $pid 2>/dev/null
  fi
done
sleep 1

echo ""
echo "🚀 Starting Next.js on port $APP_PORT..."
cd "$PROJECT_DIR"
PORT=$APP_PORT npm run dev &
NEXT_PID=$!

echo "⏳ Waiting for Next.js to be ready..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT/ 2>/dev/null | grep -qE "^[23]"; then
    break
  fi
  sleep 1
  printf "."
done
echo ""

echo "🔄 Starting Inngest dev server..."
npx inngest-cli@latest dev -u http://localhost:$APP_PORT/api/inngest --no-discovery &
INNGEST_PID=$!

echo ""
echo "✅ Discovery OS is running:"
echo "   App:     http://localhost:$APP_PORT"
echo "   Inngest: http://localhost:$INNGEST_PORT"
echo ""
echo "Press Ctrl+C to stop everything."

# Trap Ctrl+C and kill both processes cleanly
trap "echo ''; echo 'Shutting down...'; kill $NEXT_PID $INNGEST_PID 2>/dev/null; exit 0" INT TERM

# Wait for both to exit
wait $NEXT_PID $INNGEST_PID
