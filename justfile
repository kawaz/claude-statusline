default: test

lint:
    bunx oxfmt --write src/
    bunx oxlint --fix --deny-warnings src/

build: lint
    bun build src/cli.ts --outdir dist --target bun
    chmod +x dist/cli.js

test: build
    bun test

run *ARGS:
    bun run src/cli.ts {{ARGS}}

sample *ARGS:
    bun run src/cli.ts sample {{ARGS}}

register:
    bun run src/cli.ts register

ensure-clean: lint
    test "$(jj log -r @ --no-graph -T 'empty')" = "true"

push: ensure-clean test
    jj bookmark set main -r @-
    jj git push
