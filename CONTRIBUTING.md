# Contributing to generate-api-pdf

Thank you for your interest in contributing! 🎉

## Development Setup

```bash
git clone https://github.com/your-username/generate-api-pdf.git
cd generate-api-pdf
npm install
```

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Test with `--dev` flag to inspect HTML output:
   ```bash
   node bin/generate-api-pdf.mjs -i test/fixtures/petstore.json -c "Test" -p "Petstore API" --dev
   ```
4. Verify PDF has no raw HTML tags leaking (check the dev HTML file)
5. Submit a Pull Request

## Code Style

- **ES Modules** — All `.mjs` files use `import`/`export`
- **EJS templates** — Always use `<%- esc(value) %>` for spec data, never `<%= value %>`
- **CSS** — Professional theme: navy (#1e3a5f), white, grey. No gradients/pastels for print
- **No TypeScript** — Keep it simple, pure JavaScript

## Reporting Bugs

When reporting issues, please include:

- OpenAPI spec version (3.0.x / 3.1.x)
- Sample spec or minimal reproduction
- Expected vs actual output
- Whether `--dev` HTML looks correct

## Pull Request Guidelines

- One feature/fix per PR
- Update README.md if adding new options
- Test with at least one real OpenAPI spec
- Ensure `esc()` is used for all user-controlled output in templates

## Areas We'd Love Help With

- [ ] Additional color themes
- [ ] OpenAPI 2.x (Swagger) support
- [ ] Custom CSS file override option
- [ ] Internationalization (i18n) for template text
- [ ] Markdown description rendering in templates
- [ ] Automated test suite
