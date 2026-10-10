const assert = require('assert');
const path = require('path');
const { resolveStyles } = require('../src/resolveStyles');
const { traceProperty } = require('../src/traceProperty');
const { matchSelector } = require('../src/selectorMatcher');
const { calculateSpecificity, specificityToString } = require('../src/specificity');
const { buildVariableMap, enrichValue, containsVar } = require('../src/variableResolver');
const { buildCSSOM } = require('../src/cssomBuilder');

const fixtures = [
  path.join(__dirname, 'fixtures', 'buttons.css'),
  path.join(__dirname, 'fixtures', 'typography.css'),
];

async function run() {
  // ── specificity ────────────────────────────────────────────────────────────
  assert.deepStrictEqual(calculateSpecificity('#header'), [0,1,0,0], 'ID specificity');
  assert.deepStrictEqual(calculateSpecificity('.btn.primary'), [0,0,2,0], 'double class specificity');
  assert.deepStrictEqual(calculateSpecificity('div.btn'), [0,0,1,1], 'tag+class specificity');
  assert.strictEqual(specificityToString([0,1,0,0]), '(0,1,0,0)', 'specificity toString');

  // ── selector matcher ───────────────────────────────────────────────────────
  assert.strictEqual(matchSelector('.btn', '.btn'), 'certain', 'exact match');
  assert.strictEqual(matchSelector('.btn', '.btn.primary'), 'likely', '.btn likely matches .btn.primary');
  assert.strictEqual(matchSelector('.sidebar .btn', '.btn'), 'possible', 'combinator rule is possible');
  assert.strictEqual(matchSelector('.nav', '.btn'), 'none', 'unrelated selectors');

  // ── resolve_styles ─────────────────────────────────────────────────────────
  const resolved = resolveStyles({ selector: '.btn.primary', files: fixtures });
  assert.ok(!resolved.error, 'resolve_styles should not error');
  assert.ok(resolved.properties, 'should return properties');
  assert.ok(resolved.properties['background-color'], 'should resolve background-color');

  const bg = resolved.properties['background-color'];
  assert.strictEqual(bg.winner.selector, '.btn.primary', '.btn.primary wins background-color over .btn');
  assert.ok(bg.overridden.length > 0, 'background-color should have overridden rules');
  assert.ok(resolved.matchedRules > 0, 'should have matched rules');
  assert.ok(resolved.summary, 'should have a summary');
  assert.ok(resolved.agentNote, 'should have an agentNote');

  // ── resolve_styles with no match ───────────────────────────────────────────
  const noMatch = resolveStyles({ selector: '.totally-unknown', files: fixtures });
  assert.ok(!noMatch.error, 'should not error on unknown selector');
  assert.strictEqual(Object.keys(noMatch.properties).length, 0, 'no properties for unknown selector');

  // ── trace_property ─────────────────────────────────────────────────────────
  const traced = traceProperty({ property: 'color', files: fixtures });
  assert.ok(!traced.error, 'trace_property should not error');
  assert.ok(traced.occurrences.length > 0, 'color should appear in fixtures');
  assert.ok(traced.summary, 'should have summary');
  assert.ok(traced.agentNote, 'should have agentNote');

  // ── trace_property missing property ────────────────────────────────────────
  const notFound = traceProperty({ property: 'grid-template-areas', files: fixtures });
  assert.strictEqual(notFound.occurrences.length, 0, 'missing property returns empty occurrences');

  // ── error handling ─────────────────────────────────────────────────────────
  const noSelector = resolveStyles({ files: fixtures });
  assert.ok(noSelector.error, 'should return error when selector missing');

  const noProperty = traceProperty({ files: fixtures });
  assert.ok(noProperty.error, 'should return error when property missing');

  // ── variable resolver unit tests ──────────────────────────────────────────
  const varFixture = path.join(__dirname, 'fixtures', 'variables.css');
  const varCSOM = buildCSSOM([varFixture]);
  const varMap = varCSOM.variableMap;

  assert.ok(varMap.has('--color-primary'), 'variable map should contain --color-primary');
  assert.ok(varMap.has('--spacing-md'), 'variable map should contain --spacing-md');
  assert.ok(varMap.has('--btn-color'), 'variable map should contain --btn-color (chained)');

  // simple resolution
  const simpleEnriched = enrichValue('var(--color-primary)', varMap, '.btn');
  assert.ok(simpleEnriched, 'should return enriched value for var(--color-primary)');
  assert.strictEqual(simpleEnriched.resolvedValue, '#2563eb', 'should resolve --color-primary to #2563eb');
  assert.ok(simpleEnriched.variableChain.length > 0, 'should have a variable chain');

  // chained resolution: --btn-color: var(--color-primary) -> #2563eb
  const chainedEnriched = enrichValue('var(--btn-color)', varMap, '.btn-text');
  assert.ok(chainedEnriched, 'should return enriched value for chained var');
  assert.strictEqual(chainedEnriched.resolvedValue, '#2563eb', 'chained --btn-color should resolve to #2563eb');
  assert.ok(chainedEnriched.variableChain.length >= 2, 'chained var should have at least 2 steps in chain');

  // fallback resolution
  const fallbackEnriched = enrichValue('var(--color-undefined, #ff0000)', varMap, '.btn-fallback');
  assert.ok(fallbackEnriched, 'should return enriched value for var with fallback');
  assert.strictEqual(fallbackEnriched.resolvedValue, '#ff0000', 'undefined var should use fallback value');

  // non-var value returns null
  const noVar = enrichValue('#2563eb', varMap, '.btn');
  assert.strictEqual(noVar, null, 'non-var value should return null from enrichValue');

  // containsVar
  assert.ok(containsVar('var(--color-primary)'), 'should detect var()');
  assert.ok(!containsVar('#2563eb'), 'should not detect var() in plain value');

  // resolve_styles includes variables map
  const varResolved = resolveStyles({ selector: '.btn', files: [varFixture] });
  assert.ok(varResolved.variables, 'resolve_styles should include variables map');
  assert.ok(varResolved.variables['--color-primary'], 'variables map should include --color-primary');
  assert.strictEqual(varResolved.variables['--color-primary'].resolvedValue, '#2563eb', 'variable summary should show resolved value');

  // winner should have resolvedValue for var() properties
  const bgColor = varResolved.properties['background-color'];
  assert.ok(bgColor, 'should resolve background-color for .btn');
  assert.strictEqual(bgColor.winner.value, 'var(--color-primary)', 'winner value should be raw var()');
  assert.strictEqual(bgColor.winner.resolvedValue, '#2563eb', 'winner resolvedValue should be resolved');

  // media context conditionals
  const primaryVar = varResolved.variables['--color-primary'];
  assert.ok(primaryVar.conditionalValues, '--color-primary should have conditional media values');

  // trace_property includes variables
  const varTraced = traceProperty({ property: 'background-color', files: [varFixture] });
  assert.ok(varTraced.variables, 'trace_property should include variables map');
  assert.ok(varTraced.occurrences[0].resolvedValue, 'trace occurrence should have resolvedValue');

  // ── CSS Modules ───────────────────────────────────────────────────────────
  const { isCSSModule, isGlobalInModule, tagModuleRules, shouldSuppressCrossModuleConflict } = require('../src/cssModulesAnalyzer');

  assert.ok(isCSSModule('Button.module.css'), 'should detect .module.css');
  assert.ok(isCSSModule('Card.module.scss'), 'should detect .module.scss');
  assert.ok(!isCSSModule('styles.css'), 'should not flag regular css as module');

  assert.ok(isGlobalInModule(':root'), 'should treat :root as global in module');
  assert.ok(isGlobalInModule('*'), 'should treat * as global in module');
  assert.ok(!isGlobalInModule('.btn'), 'should treat .btn as locally scoped');

  const btnFixture = path.join(__dirname, 'fixtures', 'Button.module.css');
  const cardFixture = path.join(__dirname, 'fixtures', 'Card.module.css');
  const moduleCSSOM = buildCSSOM([btnFixture, cardFixture]);
  const btnRule = moduleCSSOM.rules.find(r => r.selector === '.btn' && r.source.file === btnFixture);
  const cardBtnRule = moduleCSSOM.rules.find(r => r.selector === '.btn' && r.source.file === cardFixture);
  assert.ok(btnRule && btnRule.cssModule === true, '.btn from module file should be tagged cssModule: true');
  assert.ok(btnRule && btnRule.localScope === true, '.btn from module file should be locally scoped');
  assert.ok(shouldSuppressCrossModuleConflict(btnRule, cardBtnRule), 'cross-module .btn conflict should be suppressed');
  assert.ok(!shouldSuppressCrossModuleConflict(btnRule, btnRule), 'same-file conflict should not be suppressed');

  // ── SCSS nesting ──────────────────────────────────────────────────────
  const { expandSCSS, combineSelectors } = require('../src/scssNestingExpander');

  assert.strictEqual(combineSelectors('.btn', '&:hover'), '.btn:hover', '& reference should combine correctly');
  assert.strictEqual(combineSelectors('.btn', '&.sm'), '.btn.sm', '& modifier should combine correctly');
  assert.strictEqual(combineSelectors('.card', '.title'), '.card .title', 'descendant should add space');

  const scssFixture = path.join(__dirname, 'fixtures', 'nested.scss');
  const scssCSSOM = buildCSSOM([scssFixture]);
  const cardTitleRule = scssCSSOM.rules.find(r => r.selector === '.card .title');
  const cardHoverRule = scssCSSOM.rules.find(r => r.selector === '.card:hover');
  const btnHoverRule = scssCSSOM.rules.find(r => r.selector === '.btn:hover');
  const btnSmRule = scssCSSOM.rules.find(r => r.selector === '.btn.sm');
  assert.ok(cardTitleRule, 'nested .card .title should be expanded');
  assert.ok(cardHoverRule, 'nested &:hover should expand to .card:hover');
  assert.ok(btnHoverRule, 'nested .btn &:hover should expand to .btn:hover');
  assert.ok(btnSmRule, 'nested .btn &.sm should expand to .btn.sm');

  // ── AST component graph ───────────────────────────────────────────────
  const { buildComponentGraph, graphConfirmsAncestry, extractComponentInfo } = require('../src/astComponentGraph');

  const jsxFixture = path.join(__dirname, 'fixtures', 'components.jsx');
  if (require('fs').existsSync(jsxFixture)) {
    const graphResult = buildComponentGraph([jsxFixture]);
    assert.ok(graphResult.componentMap, 'should build component map');
    assert.ok(graphResult.ancestorMap, 'should build ancestor map');
  }

  // graph-aware matching upgrades possible to likely
  const { matchSelectorWithGraph } = require('../src/selectorMatcher');
  const fakeAncestorMap = new Map([['.btn', new Set(['.sidebar'])]]);
  assert.strictEqual(matchSelectorWithGraph('.sidebar .btn', '.btn', fakeAncestorMap), 'likely', 'graph should upgrade possible to likely when ancestry confirmed');
  assert.strictEqual(matchSelectorWithGraph('.nav .btn', '.btn', fakeAncestorMap), 'possible', 'graph should leave possible when ancestry not confirmed');

  // ── live_resolve ────────────────────────────────────────────────────────
  const { liveResolve } = require('../src/liveResolve');
  const { CdpNotRunningError, discoverTabs, selectTab } = require('../src/cdpBridge');

  // CdpNotRunningError should include actionable instructions for all platforms
  const cdpErr = new CdpNotRunningError(9222);
  assert.ok(cdpErr.message.includes('--remote-debugging-port'), 'error should include flag name');
  assert.ok(cdpErr.message.includes('resolve_styles'), 'error should suggest fallback');
  assert.ok(cdpErr.message.includes('Windows'), 'error should include Windows instructions');
  assert.ok(cdpErr.message.includes('macOS'), 'error should include macOS instructions');
  assert.strictEqual(cdpErr.code, 'CDP_NOT_RUNNING', 'error should have correct code');

  // selectTab should pick by URL pattern
  const fakeTabs = [
    { id: '1', title: 'Home', url: 'http://localhost:3000/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/1' },
    { id: '2', title: 'About', url: 'http://localhost:3000/about', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/2' },
  ];
  assert.strictEqual(selectTab(fakeTabs, '/about').id, '2', 'selectTab should match by URL pattern');
  assert.strictEqual(selectTab(fakeTabs, null).id, '1', 'selectTab should default to first tab');
  assert.strictEqual(selectTab([], null), null, 'selectTab should return null for empty tab list');

  // liveResolve should return CDP_NOT_RUNNING error when Chrome is not available
  const liveResult = await liveResolve({ selector: '.btn', port: 19999 });
  assert.ok(liveResult.error, 'liveResolve should return error when CDP not reachable');
  assert.ok(liveResult.code === 'CDP_NOT_RUNNING' || liveResult.error.includes('Node'), 'error should be CDP or Node version');

  // ── impact_preview ───────────────────────────────────────────────────
  const { impactPreview } = require('../src/impactPreview');

  // changing background-color on .btn should detect .btn.primary as shielded
  const impact1 = impactPreview({
    selector: '.btn',
    property: 'background-color',
    newValue: '#ff0000',
    files: fixtures,
  });
  assert.ok(!impact1.error, 'impact_preview should not error');
  assert.ok(impact1.blastRadius, 'should return blastRadius');
  assert.ok(impact1.impacts.length > 0, 'should find at least one impact');
  assert.ok(impact1.riskLevel, 'should return riskLevel');
  assert.ok(typeof impact1.safeToChange === 'boolean', 'should return safeToChange boolean');
  assert.ok(impact1.summary, 'should return summary');
  assert.ok(impact1.agentNote, 'should return agentNote');

  // the direct value-change impact on .btn itself should always be present
  const directImpact = impact1.impacts.find(i => i.type === 'value-change' && i.affectedSelector === '.btn');
  assert.ok(directImpact, 'should include value-change impact for the changed selector itself');
  assert.strictEqual(directImpact.newValue, '#ff0000', 'new value should be reflected in impact');

  // changing --color-primary (variable) should surface variable downstream impacts
  const impactVarFixture = path.join(__dirname, 'fixtures', 'variables.css');
  const impact2 = impactPreview({
    selector: ':root',
    property: '--color-primary',
    newValue: '#ff0000',
    files: [impactVarFixture],
  });
  assert.ok(!impact2.error, 'variable impact_preview should not error');
  assert.ok(impact2.change.isVariableChange === true, 'should flag as variable change');
  assert.ok(impact2.variableImpacts.length > 0, 'should find variable downstream impacts');
  const varImpact = impact2.variableImpacts.find(i => i.type === 'variable-downstream');
  assert.ok(varImpact, 'should include variable-downstream impact');
  assert.ok(varImpact.currentResolvedValue, 'should show current resolved value');
  assert.ok(varImpact.newResolvedValue, 'should show new resolved value after change');

  // missing required params should error
  const noSelectorImpact = impactPreview({ property: 'color', files: fixtures });
  assert.ok(noSelectorImpact.error, 'should error when selector missing');
  const noPropertyImpact = impactPreview({ selector: '.btn', files: fixtures });
  assert.ok(noPropertyImpact.error, 'should error when property missing');

  // ── style_manifest ────────────────────────────────────────────────
  const { styleManifest } = require('../src/styleManifest');

  const manifest = styleManifest({ files: fixtures });
  assert.ok(!manifest.error, 'style_manifest should not error');
  assert.ok(manifest.meta, 'should return meta');
  assert.ok(manifest.selectors, 'should return selectors');
  assert.ok(manifest.properties, 'should return properties');
  assert.ok(manifest.variables !== undefined, 'should return variables');
  assert.ok(manifest.riskHotspots, 'should return riskHotspots');
  assert.ok(manifest.files, 'should return files');
  assert.ok(manifest.agentGuide, 'should return agentGuide');

  // selector index should contain expected selectors from fixtures
  assert.ok(manifest.selectors['.btn'], 'selector index should contain .btn');
  assert.ok(manifest.selectors['.btn'].properties.length > 0, '.btn should have properties listed');
  assert.ok(manifest.selectors['.btn'].specificity, '.btn should have specificity');

  // property index should only include multi-rule properties
  if (manifest.properties['color']) {
    assert.ok(manifest.properties['color'].totalRules > 1, 'multi-rule properties should have totalRules > 1');
  }

  // meta should be accurate
  assert.ok(manifest.meta.selectorCount > 0, 'selectorCount should be > 0');
  assert.ok(manifest.meta.fileCount === fixtures.length, 'fileCount should match input');

  // variable manifest from variable fixture
  const varFixtureManifest = styleManifest({ files: [path.join(__dirname, 'fixtures', 'variables.css')] });
  assert.ok(Object.keys(varFixtureManifest.variables).length > 0, 'variable manifest should include variables');
  assert.ok(varFixtureManifest.variables['--color-primary'], 'should include --color-primary');
  assert.ok(varFixtureManifest.variables['--color-primary'].resolvedValue, 'should include resolvedValue for variable');

  // maxSelectors limit
  const limitedManifest = styleManifest({ files: fixtures, maxSelectors: 1 });
  assert.ok(Object.keys(limitedManifest.selectors).length <= 1, 'maxSelectors should limit output');
  assert.ok(limitedManifest.meta.truncated === true || Object.keys(limitedManifest.selectors).length <= 1, 'should flag truncation when limited');

  // no files should error
  const noFiles = styleManifest({});
  assert.ok(noFiles.error, 'should error when no files provided');

  // ── CSS-in-JS (styled-components / Emotion) ──────────────────────────
  const fs = require('fs');
  const { extractCssInJs, detectLibrary, toKebabCase, findAmbiguousComponents } = require('../src/cssInJsExtractor');
  const { discoverStyleFiles } = require('../src/cssomBuilder');

  const styledFixture = path.join(__dirname, 'fixtures', 'styled.jsx');
  const typedFixture = path.join(__dirname, 'fixtures', 'Typed.tsx');
  const emotionFixture = path.join(__dirname, 'fixtures', 'emotion.js');
  const plainJsFixture = path.join(__dirname, 'fixtures', 'not-css-in-js.js');

  // library detection
  assert.strictEqual(detectLibrary("import styled from 'styled-components';"), 'styled-components', 'detects styled-components');
  assert.strictEqual(detectLibrary("import styled from '@emotion/styled';"), 'emotion', 'detects @emotion/styled');
  assert.strictEqual(detectLibrary("import { css } from '@emotion/react';"), 'emotion', 'detects @emotion/react');
  assert.strictEqual(detectLibrary("const css = x => x;"), null, 'no import means no CSS-in-JS');

  // property-name conversion
  assert.strictEqual(toKebabCase('backgroundColor'), 'background-color', 'camelCase -> kebab-case');
  assert.strictEqual(toKebabCase('WebkitTransition'), '-webkit-transition', 'vendor prefix (Webkit)');
  assert.strictEqual(toKebabCase('msTransform'), '-ms-transform', 'vendor prefix (ms)');
  assert.strictEqual(toKebabCase('--my-var'), '--my-var', 'custom properties untouched');

  // plain JS without a CSS-in-JS import is ignored
  const plainExtract = extractCssInJs(fs.readFileSync(plainJsFixture, 'utf8'), plainJsFixture);
  assert.strictEqual(plainExtract.rules.length, 0, 'file without a styled-components/Emotion import yields no rules');

  // tagged-template extraction
  const sc = extractCssInJs(fs.readFileSync(styledFixture, 'utf8'), styledFixture);
  assert.strictEqual(sc.library, 'styled-components', 'library detected for styled.jsx');
  // extractor output nests provenance under rule.meta (buildCSSOM flattens it) — flatten for convenience here
  const scRule = sel => { const r = sc.rules.find(x => x.selectors.includes(sel) && !x.mediaContext); return r && { ...r, ...r.meta }; };
  const scDecl = (sel, prop) => (scRule(sel) || { declarations: [] }).declarations.find(d => d.prop === prop);

  assert.ok(scRule('.Button'), 'styled.button becomes .Button');
  assert.ok(scRule('.Button:hover'), '&:hover nests under the component');
  assert.ok(scRule('.Button:focus'), 'bare :focus attaches to the parent like styled-components does');
  assert.ok(scRule('.Button.Button'), '&& doubles the class (specificity bump)');
  assert.ok(scRule('.Button .Icon'), '${Icon} component selector becomes .Icon descendant');
  assert.ok(sc.rules.find(r => r.selectors.includes('.Button') && r.mediaContext === '@media (min-width: 768px)'), '@media blocks are preserved');
  assert.strictEqual(scDecl('.Button', 'background-color').value, '#2563eb', 'same-file object constant resolved (colors.primary)');
  assert.strictEqual(scDecl('.Button', 'display').value, 'flex', 'css`` helper mixin is inlined');
  assert.strictEqual(scDecl('.Icon', 'color').value, '#2563eb', 'same-file string constant resolved (BRAND)');
  assert.ok(!scDecl('.Button', 'color').value.includes('#'), 'prop-dependent value is not guessed');
  assert.strictEqual(scDecl('.Button', 'color').dynamic, true, 'prop-dependent value flagged dynamic');
  assert.ok(scRule('.Button').dynamicInterpolations >= 1, 'dropped conditional block is counted');
  assert.strictEqual(scRule('.PrimaryButton').extends, 'Button', 'styled(Base) records extends');
  assert.strictEqual(scRule('.Wrapper').tag, 'div', '.attrs() chain still extracts the component');
  assert.ok(scRule('body') && scRule('body').kind === 'global' && scRule('body').localScope === false, 'createGlobalStyle rules keep real selectors and are not locally scoped');
  assert.ok(!sc.rules.some(r => r.selectors.some(s => s.includes('fade'))), 'keyframes are not emitted as rules');
  assert.ok(sc.skipped.some(s => /css prop/i.test(s.reason)), 'anonymous Emotion css prop is reported as skipped');
  assert.ok(sc.rules.every(r => r.source.file === styledFixture && r.source.line > 0), 'rules carry file + line');

  // TypeScript generics
  const ts = extractCssInJs(fs.readFileSync(typedFixture, 'utf8'), typedFixture);
  assert.ok(ts.rules.find(r => r.selectors.includes('.Tab')), 'styled.button<Props>`` (TS generics) extracts');
  assert.strictEqual(ts.rules.find(r => r.selectors.includes('.Tab')).declarations.find(d => d.prop === 'color').dynamic, true, 'destructured prop function is dynamic');

  // object syntax
  const em = extractCssInJs(fs.readFileSync(emotionFixture, 'utf8'), emotionFixture);
  assert.strictEqual(em.library, 'emotion', 'library detected for emotion.js');
  const emRule = (sel, media) => em.rules.find(r => r.selectors.includes(sel) && (media ? r.mediaContext === media : !r.mediaContext));
  const emDecl = (sel, prop, media) => (emRule(sel, media) || { declarations: [] }).declarations.find(d => d.prop === prop);

  assert.strictEqual(emDecl('.Panel', 'padding').value, '16px', 'unitless number gets px');
  assert.strictEqual(emDecl('.Panel', 'opacity').value, '0.9', 'unitless property keeps bare number');
  assert.strictEqual(emDecl('.Panel', 'z-index').value, '10', 'z-index stays unitless');
  assert.strictEqual(emDecl('.Panel', 'line-height').value, '1.5', 'line-height stays unitless');
  assert.strictEqual(emDecl('.Panel', 'border-radius').value, '6px', 'same-file object constant resolved (theme.radius)');
  assert.ok(emDecl('.Panel', '-webkit-transition'), 'WebkitTransition -> -webkit-transition');
  assert.ok(emDecl('.Panel', '-ms-transform'), 'msTransform -> -ms-transform');
  assert.ok(emDecl('.Panel', '--panel-bg'), 'custom property keys preserved');
  assert.strictEqual(emDecl('.Panel', 'box-sizing').value, 'border-box', 'spread of a css({}) helper is inlined');
  assert.strictEqual(emDecl('.Panel', 'color').dynamic, true, 'non-literal object value flagged dynamic');
  assert.ok(emRule('.Panel:hover'), "'&:hover' key nests");
  assert.ok(emRule('.Panel:focus'), "':focus' key attaches to the parent");
  assert.ok(emRule('.Panel .title'), "'.title' key nests as descendant");
  assert.strictEqual(emDecl('.Panel', 'padding', '@media (min-width: 600px)').value, '12px', 'numeric constant in object syntax gets px inside @media');
  assert.ok(emRule('.Heading'), "styled('h2')(props => ({...})) extracts");
  assert.strictEqual(emDecl('.Heading', 'font-size').value, '24px', 'static value inside a function-returned object is certain');
  assert.strictEqual(emDecl('.Heading', 'color').dynamic, true, 'prop-dependent value inside function-returned object is dynamic');
  assert.ok(emRule('.buttonStyles'), 'named css`` for the Emotion css prop is addressable');

  // edge cases (inline sources)
  const inlineSrc = src => extractCssInJs("import styled, { css } from 'styled-components';\n" + src, 'inline.js');

  const mqResolved = inlineSrc("const bp = { md: '(min-width: 768px)' };\nconst I = styled.div`\n  @media ${bp.md} { color: red; }\n`;");
  assert.strictEqual(mqResolved.rules[0].mediaContext, '@media (min-width: 768px)', '@media ${const} resolves from a same-file constant');

  const mqDynamic = inlineSrc("const I = styled.div`\n  @media ${props => props.mq} { color: red; }\n`;");
  assert.ok(mqDynamic.rules[0].mediaContext.includes('${'), 'unresolvable @media interpolation is preserved as ${...}, not guessed');

  const multiLine = inlineSrc("const H = styled\n  .div`color: red;`;");
  assert.ok(multiLine.rules.find(r => r.selectors.includes('.H')), 'styled chain split across lines still extracts');

  const multiSel = inlineSrc("const Icon = styled.i``;\nconst Link = styled.a``;\nconst C = styled.div`\n  ${Icon}, ${Link} { color: red; }\n  ${Link}:hover & { color: green; }\n`;");
  assert.ok(multiSel.rules.find(r => r.selectors.join(',') === '.C .Icon,.C .Link'), 'comma-separated component selectors expand');
  assert.ok(multiSel.rules.find(r => r.selectors.includes('.Link:hover .C')), '${Link}:hover & places the component before the parent');

  const nestedTpl = inlineSrc("const A = styled.div`\n  color: red;\n  ${p => p.x && css`\n    background: ${p.bg};\n    &:hover { color: ${`blue`}; }\n  `}\n  margin: 0;\n`;");
  assert.strictEqual(nestedTpl.rules.length, 1, 'nested template inside an interpolation does not break extraction');
  assert.deepStrictEqual(nestedTpl.rules[0].declarations.map(d => d.prop), ['color', 'margin'], 'static declarations around a dropped conditional block survive');

  const urlComments = inlineSrc("const B = styled.div`\n  background: url(//cdn.example.com/a.png);\n  // comment with { brace\n  width: calc(100% - ${8}px);\n`;");
  assert.strictEqual(urlComments.rules[0].declarations.find(d => d.prop === 'background').value, 'url(//cdn.example.com/a.png)', '// inside url() is not treated as a comment');
  assert.strictEqual(urlComments.rules[0].declarations.find(d => d.prop === 'width').value, 'calc(100% - 8px)', 'literal interpolation inlined');

  const strFalsePositive = inlineSrc("const cssText = 'css`not real`';\nfunction styledThing() { return 1 }");
  assert.strictEqual(strFalsePositive.skipped.length, 0, 'css` inside a string literal is not reported as skipped');

  assert.doesNotThrow(() => inlineSrc("const D = styled.div`\n  color: red;\n  ${oops"), 'unterminated template does not throw');
  assert.doesNotThrow(() => inlineSrc("const E = styled.div({\n  color: 'red',\n  '&:hover': {"), 'unterminated object does not throw');

  // performance guard — line lookup must not be quadratic
  let bigSrc = "import styled from 'styled-components';\n";
  for (let i = 0; i < 1500; i++) bigSrc += 'const C' + i + ' = styled.div`\n  color: red;\n  &:hover { color: blue; }\n`;\n';
  const bigStart = Date.now();
  const bigResult = extractCssInJs(bigSrc, 'big.js');
  assert.strictEqual(bigResult.rules.length, 3000, 'large file extracts every rule');
  assert.ok(Date.now() - bigStart < 5000, 'large file extracts in a reasonable time');

  // same component name in two files is reported as ambiguous
  const ambiguous = findAmbiguousComponents(
    [...sc.rules, ...ts.rules].flatMap(r => r.selectors.map(s => ({ ...r.meta, selector: s, source: r.source })))
  );
  assert.ok(ambiguous.some(a => a.component === 'Wrapper'), 'Wrapper defined in two files is flagged ambiguous');

  // discovery: projectRoot finds JS/TS files that import a CSS-in-JS library, and only those
  const discovered = discoverStyleFiles(path.join(__dirname, 'fixtures')).map(f => path.basename(f));
  assert.ok(discovered.includes('styled.jsx') && discovered.includes('Typed.tsx') && discovered.includes('emotion.js'), 'discovery includes CSS-in-JS files');
  assert.ok(!discovered.includes('not-css-in-js.js'), 'discovery skips JS files with no CSS-in-JS import');

  // buildCSSOM: CSS-in-JS flows through the shared cascade model
  const cssInJsCSSOM = buildCSSOM([styledFixture, typedFixture]);
  assert.ok(cssInJsCSSOM.cssInJs && cssInJsCSSOM.cssInJs.fileCount === 2, 'cssom reports CSS-in-JS file count');
  assert.ok(cssInJsCSSOM.cssInJs.ambiguousComponents.some(a => a.component === 'Wrapper'), 'cssom reports ambiguous component names');
  const cssomButton = cssInJsCSSOM.rules.find(r => r.selector === '.Button');
  assert.ok(cssomButton.cssInJs === true && cssomButton.localScope === true, 'cssom rules carry CSS-in-JS metadata');
  assert.deepStrictEqual(cssomButton.specificity, [0, 0, 1, 0], 'styled component has single-class specificity');
  assert.deepStrictEqual(cssInJsCSSOM.rules.find(r => r.selector === '.Button.Button').specificity, [0, 0, 2, 0], '&& raises specificity');
  assert.ok(shouldSuppressCrossModuleConflict(
    cssInJsCSSOM.rules.find(r => r.selector === '.Wrapper' && r.source.file === styledFixture),
    cssInJsCSSOM.rules.find(r => r.selector === '.Wrapper' && r.source.file === typedFixture)
  ), 'same-named components in different files do not conflict');

  // resolve_styles on a styled component
  const scResolved = resolveStyles({ selector: '.Button', files: [styledFixture] });
  assert.ok(!scResolved.error, 'resolve_styles should work on CSS-in-JS files');
  assert.strictEqual(scResolved.properties['background-color'].winner.cssInJs, true, 'winner carries CSS-in-JS provenance');
  assert.strictEqual(scResolved.properties['background-color'].winner.component, 'Button', 'winner names its component');
  assert.strictEqual(scResolved.properties['color'].dynamic, true, 'dynamic property is flagged at property level');
  assert.ok(scResolved.cssInJs && scResolved.cssInJs.dynamicProperties.includes('color'), 'cssInJs summary lists dynamic properties');
  assert.ok(/props\/theme/.test(scResolved.agentNote), 'agentNote warns about runtime-dependent values');
  const iconResolved = resolveStyles({ selector: '.Icon', files: [styledFixture] });
  assert.ok(iconResolved.properties['margin-right'], 'component-selector rule (${Icon}) applies to .Icon via ancestor rule');
  assert.strictEqual(iconResolved.properties['margin-right'].confidence, 'possible', 'ancestor rule is possible, not certain');
  const extResolved = resolveStyles({ selector: '.PrimaryButton', files: [styledFixture] });
  assert.ok(/extends Button/.test(extResolved.agentNote), 'agentNote points at the base component for styled(Base)');

  // trace_property across CSS and CSS-in-JS together
  const mixedTrace = traceProperty({ property: 'color', files: [styledFixture, path.join(__dirname, 'fixtures', 'buttons.css')] });
  assert.ok(mixedTrace.occurrences.some(o => o.cssInJs && o.component === 'Icon'), 'trace_property includes CSS-in-JS occurrences');
  assert.ok(mixedTrace.occurrences.some(o => o.dynamic), 'trace_property flags dynamic occurrences');

  // impact_preview on a styled component
  const scImpact = impactPreview({ selector: '.Button', property: 'background-color', newValue: '#ff0000', files: [styledFixture] });
  assert.ok(!scImpact.error, 'impact_preview should work on CSS-in-JS');
  assert.ok(scImpact.impacts.find(i => i.type === 'value-change' && i.affectedSelector === '.Button'), 'impact_preview reports the direct change on a styled component');

  // style_manifest with CSS-in-JS
  const scManifest = styleManifest({ files: [styledFixture, typedFixture, emotionFixture] });
  assert.ok(scManifest.cssInJs && scManifest.cssInJs.componentCount > 0, 'manifest includes cssInJs summary');
  assert.ok(scManifest.cssInJs.skipped.length > 0, 'manifest surfaces skipped (non-extractable) blocks');
  assert.ok(scManifest.selectors['.Button'].cssInJs === true, 'manifest tags CSS-in-JS selectors');
  assert.ok(scManifest.selectors['.Button'].hasDynamicValues === true, 'manifest flags selectors with dynamic values');
  assert.ok(!scManifest.riskHotspots.some(h => h.selector === '.Wrapper' && h.reasons.some(r => /locations/.test(r))), 'same-named components are not a "declared in N locations" hotspot');
  assert.ok(/CSS-IN-JS/.test(scManifest.agentGuide), 'agentGuide explains CSS-in-JS addressing');
  assert.ok(scManifest.meta.cssInJsFileCount === 3, 'meta reports CSS-in-JS file count');

  console.log('stylespeak regression checks passed');
}

run().catch(err => { console.error(err); process.exit(1); });
