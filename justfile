default: lint build test

lint:
    bunx oxfmt --write src/
    bunx oxlint --fix src/

test:
    bun test

build:
    bun build src/cli.ts --outdir dist --target bun
    chmod +x dist/cli.js

run *ARGS:
    bun run src/cli.ts {{ARGS}}

sample *ARGS:
    bun run src/cli.ts sample {{ARGS}}

register:
    bun run src/cli.ts register
