#!/opt/homebrew/bin/fish

set -l script_path (status filename)
set -l root_dir (cd (dirname $script_path)/..; pwd)
cd "$root_dir"

if not test -f .env
    set -l example_file .env.example
    if not test -f $example_file
        set example_file env.example
    end
    cp $example_file .env
    echo "Created .env from $example_file."
end

echo "Starting ai-planner-lite..."
npm run dev
