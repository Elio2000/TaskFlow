#!/opt/homebrew/bin/fish

set -l script_path (status filename)
set -l root_dir (cd (dirname $script_path)/..; pwd)
cd "$root_dir"

if not test -f .env
    cp .env.example .env
    echo "Created .env from .env.example."
end

echo "Starting ai-planner-lite..."
npm run dev
