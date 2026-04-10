#!/bin/sh
set -e

echo "🔄 Running database migrations..."

# Check if migrations directory exists and has files
if [ -d "./src/db/migrations" ] && [ "$(ls -A ./src/db/migrations 2>/dev/null)" ]; then
  echo "📂 Found migrations directory, running drizzle-kit migrate..."
  /app/node_modules/.bin/drizzle-kit migrate
else
  echo "📂 No migrations found, running drizzle-kit push..."
  /app/node_modules/.bin/drizzle-kit push
fi

echo "✅ Database ready"
echo "🚀 Starting flowAIbuilder server..."

exec node dist/index.js
