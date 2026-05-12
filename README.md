# generate-api-pdf

> 📄 Generate professional, print-ready API documentation PDFs from OpenAPI JSON specs

A standalone CLI tool that transforms OpenAPI/Swagger JSON specifications into beautiful, formal PDF documents with selectable text, internal links, and search capability.

## Features

- **Professional PDF output** — Navy/white/grey color scheme, A4 format with proper margins
- **Text selectable** — Real vector PDF, not screenshots
- **Internal links** — Clickable TOC that navigates to sections
- **Multiple specs** — Combine multiple OpenAPI specs into one document
- **Customizable** — Company name, project name, theme options
- **EJS templates** — Easy to modify layout and styling
- **Zero config** — Works out of the box with any valid OpenAPI 3.x JSON

## Quick Start

```bash
# Install globally
npm install -g generate-api-pdf

# Or use with npx (no install)
npx generate-api-pdf -i openapi.json -c "Acme Corp" -p "Acme API"
```

## Usage

```bash
generate-api-pdf -i <openapi.json...> -c <company> -p <project> [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <paths...>` | OpenAPI JSON file path(s) | *required* |
| `-c, --company <name>` | Company name for cover page | *required* |
| `-p, --project <name>` | Project name for cover page | *required* |
| `-o, --output <path>` | Output PDF file path | `./<project>-api-docs.pdf` |
| `--base-url <url>` | Override base URL in documentation | From spec |
| `--auth-type <type>` | Authentication type label | From spec |
| `--theme <preset>` | Color theme: `navy` (default), `dark`, `blue` | `navy` |
| `--no-cover` | Skip cover page | — |
| `--no-toc` | Skip table of contents | — |
| `--dev` | Save intermediate HTML for debugging | — |

### Examples

```bash
# Single spec
generate-api-pdf -i api-spec.json -c "My Company" -p "My API"

# Multiple specs combined
generate-api-pdf \
  -i gateway-spec.json -i admin-spec.json \
  -c "My Company" -p "Full Platform API"

# Custom output path
generate-api-pdf -i spec.json -c "Corp" -p "API" -o ./docs/api.pdf

# Debug mode (saves HTML too)
generate-api-pdf -i spec.json -c "Corp" -p "API" --dev
```

## Programmatic API

```js
import { parseOpenApiSpec } from 'generate-api-pdf/parser.mjs';
import { renderHtml } from 'generate-api-pdf/renderer.mjs';
import { generatePdf } from 'generate-api-pdf/generator.mjs';

const spec = parseOpenApiSpec(openApiJson);
const html = renderHtml({ company: 'Acme', project: 'API', specs: [spec] });
await generatePdf(html, './output.pdf');
```

## How It Works

1. **Parse** — OpenAPI JSON → structured data (endpoints, schemas, parameters)
2. **Render** — Data + EJS templates → HTML with professional CSS
3. **Generate** — HTML → PDF via Puppeteer `page.pdf()` (vector, text-selectable)

## Template Customization

Templates live in `templates/` and use [EJS](https://ejs.co/):

```
templates/
├── main.ejs              # Master layout
└── partials/
    ├── styles.ejs        # All CSS (modify for theming)
    ├── cover.ejs         # Cover page
    ├── toc.ejs           # Table of contents
    ├── endpoints.ejs     # API endpoint sections
    ├── schemas.ejs       # Schema reference
    ├── param-table-rows.ejs
    └── param-row.ejs     # Nested property rows
```

All spec data is HTML-escaped via the `esc()` helper to prevent injection.

## Requirements

- Node.js >= 18.0.0
- Puppeteer downloads Chromium automatically on first run

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
