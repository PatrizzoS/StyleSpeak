# StyleSpeak - MCP and CLI

A companion MCP server and CLI to [stylesafe](https://www.npmjs.com/package/stylesafe) that makes CSS legible to AI agents — resolving cascade, tracing properties, predicting change impact, and explaining what applies and why before an agent touches a single line of styles.

## The problem

AI coding agents write CSS without being able to see its effect. They modify a rule, assume it worked, and move on — unaware that a higher-specificity rule elsewhere already overrides it, a combinator rule in another file is silently winning, or a CSS variable resolves to something entirely different than expected. stylespeak gives agents a structured knowledge layer to consult *before* making changes.

## What it does

**`resolve_styles`** — answers "what CSS actually applies to this selector?"

Given a selector and a set of files, returns every CSS property the selector would receive, which rule wins for each, and which rules were overridden — with confidence levels since no real DOM is available. CSS custom properties (`var()`) are resolved to their actual values, including chained variables, fallbacks, and media-context overrides.

**`trace_property`** — answers "everywhere this property is set, who wins?"

Given a property name and a set of files, returns every rule that sets it, groups competing rules that target overlapping selectors, and shows the full cascade chain for each group — with resolved variable values included.

**`impact_preview`** — answers "if I change this, what else breaks?"

Given a selector, property, and optional new value, predicts the full blast radius of the change before it's made — showing which selectors will see a different value, which are shielded by higher specificity, which cascade relationships are uncertain, and which downstream rules are affected through CSS variable chains or property inheritance. Works without a browser.

**`style_manifest`** — answers "what does this entire project's CSS look like at a glance?"

Builds a compressed, structured summary of a project's entire CSS knowledge — selectors, properties, variables, competition groups, and risk hotspots — that an agent can load once at the start of a session and keep in context instead of repeatedly querying individual files.

**`live_resolve`** — answers "what does the browser actually compute for this selector?"

Queries a running Chromium browser via CDP and returns exact computed styles and matched rules. No heuristics, no confidence levels — the browser resolved it. Requires Chrome running with `--remote-debugging-port=9222`.

**Works on more than plain CSS.** The four static tools above analyze `.css`, `.scss`, CSS Modules, and — as of v1.3 — [styled-components and Emotion](#css-in-js-support-styled-components--emotion) source files (`.js` / `.jsx` / `.ts` / `.tsx`), all through the same cascade engine.

## Quick start

### As a CLI tool

```bash
npm install -g @patrizzos/stylespeak
```

```bash
stylespeak resolve ".btn.primary" src/styles/main.css
stylespeak trace "color" --projectRoot src/styles
stylespeak impact ".btn" "background-color" src/styles/main.css --newValue "#ff0000"
stylespeak manifest --projectRoot src/styles

# styled-components / Emotion — components are addressed by variable name (const Button = styled.button`` -> .Button)
stylespeak resolve ".Button" src/components/Button.jsx
stylespeak manifest --projectRoot src
```

### As an MCP server

Add to your MCP client config (Cursor: `.cursor/mcp.json`, VS Code: `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "stylespeak": {
      "command": "node",
      "args": ["/absolute/path/to/stylespeak/src/server.js"]
    }
  }
}
```

Once connected, agents can call:
- `resolve_styles({ selector, files, projectRoot, componentFiles? })`
- `trace_property({ property, files, projectRoot })`
- `impact_preview({ selector, property, newValue?, files, projectRoot })`
- `style_manifest({ files?, projectRoot?, maxSelectors? })`
- `live_resolve({ selector, port?, tabUrl? })`

## Example output

### impact_preview

```bash
stylespeak impact ".btn" "background-color" src/styles/buttons.css --newValue "#ff0000"
```

```json
{
  "change": {
    "selector": ".btn",
    "property": "background-color",
    "currentValue": "var(--color-primary)",
    "newValue": "#ff0000"
  },
  "blastRadius": {
    "total": 3,
    "valueChanges": 1,
    "shielded": 1,
    "risks": 0,
    "variableDownstream": 0,
    "inheritanceDownstream": 1
  },
  "riskLevel": "low",
  "safeToChange": true,
  "impacts": [
    {
      "type": "value-change",
      "affectedSelector": ".btn",
      "currentValue": "var(--color-primary)",
      "newValue": "#ff0000",
      "confidence": "certain"
    },
    {
      "type": "shielded",
      "affectedSelector": ".btn.primary",
      "shieldingValue": "darkblue",
      "confidence": "certain",
      "reason": ".btn.primary has higher specificity — elements with both classes won't be affected"
    }
  ],
  "summary": "1 selector will see a different value, 1 selector is shielded by higher specificity.",
  "agentNote": "Change appears safe to make. Shielded selectors are safe — higher-specificity rules protect those elements."
}
```

### resolve_styles

```bash
stylespeak resolve ".btn" src/styles/buttons.css
```

```json
{
  "properties": {
    "background-color": {
      "winner": {
        "value": "var(--color-primary)",
        "resolvedValue": "#2563eb",
        "variableChain": ["--color-primary → #2563eb"],
        "selector": ".btn",
        "specificity": "(0,0,1,0)"
      },
      "confidence": "certain"
    }
  },
  "variables": { "--color-primary": { "value": "#2563eb", "selector": ":root" } }
}
```

## Confidence levels

| Level | Meaning |
|---|---|
| `certain` | Exact selector match — rule definitively applies |
| `likely` | Rule tokens are a subset of the queried selector — applies in most cases |
| `possible` | Combinator rule — depends on DOM ancestry, unknown without rendering |
| `exact` | Returned by `live_resolve` only — browser-resolved, no heuristics |

## CSS custom property resolution

As of v0.2, stylespeak fully resolves CSS custom properties (`var()`) in all output:

- `value` — the raw value as written (`var(--color-primary)`)
- `resolvedValue` — the actual resolved value (`#2563eb`)
- `variableChain` — the full resolution path, including chained variables
- `conditionalValues` — media-context overrides where the variable resolves differently

Supported: simple, fallback, nested fallback, chained, scoped, media-context, circular reference protection.

## CSS-in-JS support (styled-components & Emotion)

As of v1.3, stylespeak statically extracts styles from `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` and `.cjs` files that import `styled-components`, `@emotion/styled`, `@emotion/react` or `@emotion/css`, and runs them through the same cascade engine as plain CSS. `resolve_styles`, `trace_property`, `impact_preview` and `style_manifest` all work on them, and CSS-in-JS and regular CSS can be analyzed together.

Pass JS/TS files in `files`, or point `projectRoot` at a directory — files that import one of these libraries are discovered automatically and all other JS/TS files are ignored.

### Addressing components

Generated class names are hashed at runtime, so each styled component is addressed by its **variable name as a class selector**:

```js
const Button = styled.button`...`;    // -> .Button
export default styled.section`...`;   // -> .Card  (named after the file, e.g. Card.jsx)
```

Rules are tagged `cssInJs`, `library` and `component`, and are treated as locally scoped (like CSS Modules): two components named `Wrapper` in different files are independent, never reported as conflicting, and never counted as a "declared in N locations" risk. Querying such a name is flagged as ambiguous, because results will mix both files.

### What is extracted

| Syntax | Handling |
|---|---|
| Tagged templates | `` styled.div`…` ``, `` styled(Comp)`…` ``, `` styled.div.attrs(…)`…` ``, `` styled.div<Props>`…` `` (TypeScript generics), `` css`…` `` |
| Object syntax | `styled.div({ … })`, `styled(Comp)({ … })`, `css({ … })`, `styled.div(props => ({ … }))` |
| Global styles | `createGlobalStyle` / `injectGlobal` — real selectors, not locally scoped |
| Nesting | `&`, `&&` (specificity bump), `&:hover`, bare `:hover`, nested selectors, `@media` / `@supports` / `@container` |
| Component selectors | `${Icon} { … }` becomes `.Icon`, e.g. `.Button .Icon` |
| Constants | Same-file `const` strings, numbers and object paths: `${SPACING}`, `${colors.primary}`, `@media ${bp.md}` |
| `css` helpers | Same-file `` const mixin = css`…` `` is inlined where interpolated (`${mixin}`, `...mixin`) and is also queryable by its own name (tagged `css-helper`) — useful because Emotion's `css={mixin}` prop makes the helper the only visible record of those styles |
| Object notation | camelCase becomes kebab-case, vendor prefixes (`WebkitX` → `-webkit-x`, `msX` → `-ms-x`), unitless numbers get `px` (except unitless properties like `opacity`, `z-index`, `line-height`) |

### What is flagged, never guessed

Values that depend on props or theme can't be known statically. stylespeak keeps the original expression, marks it, and tells the agent:

```json
"color": {
  "winner": {
    "value": "${props => props.color}",
    "selector": ".Button",
    "cssInJs": true,
    "library": "styled-components",
    "component": "Button",
    "dynamic": true
  },
  "confidence": "certain",
  "dynamic": true
}
```

- `dynamic: true` on a declaration, winner and property means the value depends on runtime props/theme — the winner may differ depending on props.
- Conditional blocks and mixin calls (`${p => p.active && css`…`}`) can't be evaluated. They are dropped and counted in `dynamicInterpolations`, and `agentNote` warns that additional styles may apply at runtime.
- Style blocks that can't be attached to a selector are listed in `cssInJs.skipped` in `style_manifest` output instead of being silently ignored.
- `styled(Base)` records `extends`; `agentNote` tells the agent to also resolve the base component.

### Limitations

This is static analysis, so there are boundaries:

- `styled(Base)` does not merge the base component's styles into the child — resolve the base selector separately.
- Constants and theme objects imported from other files are not resolved (same-file only). `ThemeProvider` themes are not resolved.
- Emotion's `css` prop on JSX elements and style blocks not assigned to a named variable are anonymous — there is no selector to target, so they are reported as skipped.
- `keyframes` are not modeled, and `.attrs({ className })` is not considered.
- Cross-file injection order is approximated by the order files are provided.
- For ground truth on a running app, use `live_resolve` against the real element.

## How it pairs with stylesafe

**stylesafe** catches problems in your CSS — conflicts, dead rules, Tailwind clashes — before they ship.

**stylespeak** explains your CSS — resolving cascade, tracing properties, predicting impact, resolving variables — so agents understand before they act.

Use stylesafe as a post-edit check. Use stylespeak as a pre-edit consultation. Together they give AI coding agents a complete feedback loop on styles.

## Live browser inspection

`live_resolve` requires a Chromium browser running with remote debugging enabled:

```bash
# Windows
chrome.exe --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

> **Security note:** Never run `--remote-debugging-port` on a machine exposed to untrusted networks or in production. This flag opens a local API that any process on the machine can connect to.

## File format support

| Format | Support level |
|---|---|
| `.css` | Full |
| `.scss` | Full — nesting, `&` references, `@media` passthrough |
| `.module.css` / `.module.scss` | Full — locally scoped classes detected and tagged |
| vanilla-extract / Linaria / StyleX | Supported via compiled CSS output |
| styled-components / Emotion | Supported (v1.3) — static extraction from `.js` / `.jsx` / `.ts` / `.tsx` / `.mjs` / `.cjs`; props/theme-dependent values are flagged `dynamic`, not guessed |
| CSS-in-JS object syntax | Supported (v1.3) — `styled.div({…})`, `css({…})`, function-returned objects |
| Emotion `css` prop (inline JSX) | Not extractable — anonymous, reported as skipped |

## Architecture

```
src/
  cssParser.js            — CSS tokenizer with SCSS nesting support
  specificity.js          — standard (id, class, type) specificity calculator
  cssomBuilder.js         — in-memory cascade model builder (CSS, SCSS, CSS Modules, CSS-in-JS)
  selectorMatcher.js      — heuristic selector matching with confidence levels
  variableResolver.js     — CSS custom property resolution
  cssModulesAnalyzer.js   — CSS Modules local scope detection
  scssNestingExpander.js  — SCSS nesting pre-processor
  cssInJsExtractor.js     — styled-components / Emotion static extractor (template + object syntax)
  astComponentGraph.js    — AST component graph for graph-aware matching
  resolveStyles.js        — resolve_styles tool
  traceProperty.js        — trace_property tool
  impactPreview.js        — impact_preview tool
  styleManifest.js        — style_manifest project-wide knowledge builder
  cdpBridge.js            — Chrome DevTools Protocol WebSocket client
  liveResolve.js          — live_resolve tool
  server.js               — MCP server (stdio JSON-RPC) + CLI entry point
```

Zero external dependencies. Requires Node.js 21+.

## Roadmap

- **v0.2** ✅ — CSS custom property resolution
- **v0.3** ✅ — SCSS nesting, CSS Modules scope awareness, AST component graph
- **v1.0** ✅ — Chrome DevTools Protocol live resolution
- **v1.1** ✅ — impact_preview: blast radius prediction before making a change
- **v1.2** ✅ — style_manifest: compressed project-wide CSS knowledge for agent context
- **v1.3** ✅ — CSS-in-JS: static extraction for styled-components and Emotion (template and object syntax)

### Next (not yet scheduled)

Known gaps in CSS-in-JS support, in no particular order: merging `styled(Base)` styles into the child, resolving constants and theme objects imported from other files, and modeling `keyframes` and the Emotion `css` prop.
