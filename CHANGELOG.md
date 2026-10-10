# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - Unreleased

### Added
- **CSS-in-JS support (styled-components & Emotion)**: Styles are now extracted statically from `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` and `.cjs` files that import `styled-components`, `@emotion/styled`, `@emotion/react` or `@emotion/css`, and analyzed through the same cascade engine as plain CSS. `resolve_styles`, `trace_property`, `impact_preview` and `style_manifest` all work on them, alongside regular CSS.
- **CSS-in-JS extractor** (`src/cssInJsExtractor.js`): Zero-dependency scanner that handles tagged templates (`` styled.div`…` ``, `` styled(Comp)`…` ``, `.attrs()` / `.withConfig()` chains, TypeScript generics, `` css`…` ``, `createGlobalStyle`, `injectGlobal`) and object syntax (`styled.div({…})`, `css({…})`, `styled.div(props => ({…}))`).
- **Component addressing**: Each styled component is addressed by its variable name as a class selector (`const Button = styled.button\`\`` → `.Button`); `export default` components are named after their file. Rules are tagged `cssInJs`, `library` and `component`.
- **Nesting and interpolation handling**: `&`, `&&` (specificity bump), `&:hover`, bare `:hover`, nested selectors, `@media` / `@supports` / `@container`; `${Icon} {…}` component selectors; same-file constants (`${SPACING}`, `${colors.primary}`, `@media ${bp.md}`); same-file `css` helpers inlined where interpolated (`${mixin}`, `...mixin`).
- **Object-notation conversion**: camelCase → kebab-case, vendor prefixes (`WebkitX`, `msX`), unitless numbers → `px` (except unitless properties such as `opacity`, `z-index`, `line-height`).
- **Dynamic value flagging**: Prop/theme-dependent values (`${props => props.color}`) are never guessed. The original expression is preserved, the declaration, winner and property are marked `dynamic: true`, conditional blocks and mixin calls are counted in `dynamicInterpolations`, and `resolve_styles` adds a `cssInJs` summary plus `agentNote` warnings.
- **`styled(Base)` awareness**: Recorded as `extends`; `agentNote` tells the agent to also resolve the base component.
- **Scoping**: CSS-in-JS components are locally scoped like CSS Modules — same-named components in different files never conflict, are not flagged as "declared in N locations" hotspots, and are reported as ambiguous names when queried.
- **Skipped-block reporting**: Style blocks that can't be attached to a selector (Emotion `css` prop, unassigned blocks, non-literal object styles) are listed in `style_manifest` under `cssInJs.skipped` rather than silently ignored.
- **Manifest output**: `style_manifest` gains a `cssInJs` section (libraries, component count, ambiguous names, skipped blocks), `meta.cssInJsFileCount`, per-selector `cssInJs` / `hasDynamicValues` flags, and CSS-in-JS guidance in `agentGuide`.
- **Test coverage**: New fixtures (`styled.jsx`, `Typed.tsx`, `emotion.js`, `not-css-in-js.js`) and about 100 regression assertions covering extraction, edge cases (nested templates, `url(//…)`, malformed input), discovery and every tool.

### Changed
- **Discovery**: `projectRoot` discovery now also picks up JS/TS files that import styled-components or Emotion; all other JS/TS files are ignored.
- **Provenance in output**: `resolve_styles` winner/overridden entries and `trace_property` occurrences now include `cssInJs`, `library`, `component` and `dynamic` where applicable.
- **Tool descriptions**: `files` / `projectRoot` descriptions now mention JS/TS CSS-in-JS files.
- **Cross-scope conflict suppression** (`shouldSuppressCrossModuleConflict`) now also applies to CSS-in-JS components, and `style_manifest` uses it instead of its own inline check for these rules.
- **Docs**: README gains a CSS-in-JS section, updated file-format table, architecture and roadmap; this changelog is backfilled for 0.3.0 through 1.2.0.
- **Version**: Bumped to 1.3.0 in `package.json`, `server.json` and the MCP `serverInfo`.

### Fixed
- **server.js**: Header comment now says five tools (was four); the unknown-command CLI error now lists `manifest`.
- **cssParser.js**: Header comment referred to the old name "stylescope".

## [1.2.0] - 2026-08-01

### Added
- **style_manifest**: Compressed, project-wide CSS knowledge for agent context — selector, property and variable indexes, competition groups, risk hotspots, per-file summaries and an `agentGuide`, with a `maxSelectors` limit that prioritizes hotspots when truncating.
- **CLI**: `manifest [file...] [--projectRoot <dir>] [--maxSelectors <n>]` command.

## [1.1.0] - 2026-08-01

### Added
- **impact_preview**: Predicts the blast radius of a proposed CSS change before it is made — selectors that will see a different value, selectors shielded by higher specificity, uncertain cascade relationships, and downstream effects through CSS variable chains and property inheritance. Returns `riskLevel` and `safeToChange`. Works without a browser.
- **CLI**: `impact <selector> <property> [file...] [--projectRoot <dir>] [--newValue <value>]` command.

## [1.0.0] - 2026-07-31

### Added
- **live_resolve**: Resolves CSS for a selector by querying a running Chromium browser over the Chrome DevTools Protocol — exact computed styles and every matched rule in cascade order, no heuristics (`exact` confidence).
- **CDP bridge** (`src/cdpBridge.js`): Zero-dependency WebSocket client, tab discovery and URL-based tab selection; a `CDP_NOT_RUNNING` error with per-platform instructions when no browser is listening.

## [0.3.0] - 2026-07-19

### Added
- **SCSS nesting** (`src/scssNestingExpander.js`): Nested rules, `&` references and `@media` passthrough are expanded before parsing.
- **CSS Modules scope awareness** (`src/cssModulesAnalyzer.js`): `.module.css` / `.module.scss` classes are tagged as locally scoped, and cross-module conflicts between same-named classes are suppressed.
- **AST component graph** (`src/astComponentGraph.js`): Optional `componentFiles` input builds a JSX/TSX component graph that upgrades combinator-rule confidence from `possible` to `likely` when ancestry is confirmed.

## [0.2.0] - 2026-07-09

### Added
- **CSS custom property resolution** (`src/variableResolver.js`, committed 2026-07-16): `var()` values are resolved in all output — `resolvedValue`, `variableChain` and media-context `conditionalValues`; supports fallbacks, nested fallbacks, chained and scoped variables, with circular-reference protection.
- **resolve_styles**: Resolves what CSS actually applies to a given selector — every property the selector receives, which rule wins for each property, and which rules were overridden with confidence levels (certain/likely/possible).
- **trace_property**: Traces a CSS property across all provided files — finds every rule that sets it, groups competing rules targeting overlapping selectors, shows who wins in each group.
- **CLI interface**: `node server.js resolve <selector> [file...] [--projectRoot <dir>]` and `node server.js trace <property> [file...] [--projectRoot <dir>]`.
- **MCP server mode**: Reads JSON-RPC from stdin, exposes two tools — `resolve_styles` and `trace_property`.
- **CSSOM builder** (`src/cssomBuilder.js`): Builds a CSS Object Model from file paths for cascade analysis.
- **Selector matcher** (`src/selectorMatcher.js`): Matches selectors against each other to determine competing relationships (e.g., `.btn` vs `.btn.primary`).
- **Specificity calculator** (`src/specificity.js`): Calculates CSS specificity scores and formats them as human-readable strings like "0,2,1".

### Changed
- **server.js**: Now serves both CLI mode (when run with arguments) and MCP server mode (stdin JSON-RPC). Handles `initialize`, `tools/list`, `tools/call`, and error responses.

## [0.1.1] - 2026-07-09 (patch)

### Fixed
- **server.js**: Added proper error handling for unknown tools and malformed requests in MCP server mode.

## [0.1.0] - 2026-07-03

### Added
- **Initial release**: Basic CSS cascade analysis tools for AI agents.
- **Core modules**: `cssParser.js` (parses CSS files into a structured model), `specificity.js` (calculates specificity scores).
- **README.md** with usage examples and API documentation.
