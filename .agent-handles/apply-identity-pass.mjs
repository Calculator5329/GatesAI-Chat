import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const registry = JSON.parse(fs.readFileSync('testid-registry.json', 'utf8'));

function kebab(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .replace(/-{2,}/g, '-')
    .slice(0, 56)
    .replace(/-+$/g, '') || 'control';
}

function addressFor(file) {
  const base = kebab(path.basename(file, path.extname(file)));
  if (file.includes('/dock/')) return ['workspace', base];
  if (file.includes('/editorial/composer/')) return ['workspace', base];
  if (file.includes('/editorial/activity/')) return ['workspace', `activity-${base}`];
  if (file.includes('/editorial/aurora/')) return ['workspace', `aurora-${base}`];
  if (file.includes('/editorial/')) return ['workspace', base];
  if (file.includes('/media/')) return ['app', base];
  if (file.includes('/menu/sections/api/')) return ['settings', `models-${base}`];
  if (file.endsWith('/menu/sections/Agent.tsx')) return ['settings', 'agent'];
  if (file.endsWith('/menu/sections/Settings.tsx')) return ['settings', 'preferences'];
  if (file.includes('/menu/')) return ['settings', base];
  if (file.includes('/palette/')) return ['app', 'command-palette'];
  if (file.includes('/ui/')) return ['ui', base];
  if (file.includes('/whats-new/')) return ['app', 'whats-new'];
  return ['app', base];
}

function attr(node, sourceFile, name) {
  const found = node.attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name);
  if (!found?.initializer) return undefined;
  if (ts.isStringLiteral(found.initializer)) return found.initializer.text;
  if (ts.isJsxExpression(found.initializer) && found.initializer.expression) {
    const expression = found.initializer.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isTemplateExpression(expression)) return expression.head.text;
  }
  return undefined;
}

function expressionAttr(node, sourceFile, name) {
  const found = node.attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name);
  if (!found?.initializer || !ts.isJsxExpression(found.initializer) || !found.initializer.expression) return undefined;
  return found.initializer.expression.getText(sourceFile);
}

function directText(node) {
  if (!ts.isJsxElement(node.parent) || node.parent.openingElement !== node) return undefined;
  const text = node.parent.children
    .filter(ts.isJsxText)
    .map(child => child.text.trim())
    .find(Boolean);
  return text;
}

function descriptor(node, sourceFile, tag) {
  const semantic = [
    attr(node, sourceFile, 'aria-label'),
    attr(node, sourceFile, 'title'),
    attr(node, sourceFile, 'placeholder'),
    directText(node),
  ].find(Boolean);
  if (semantic) return kebab(semantic);

  const className = attr(node, sourceFile, 'className');
  if (className) {
    const token = className.split(/\s+/).find(value => value.includes('__'))
      ?? className.split(/\s+/).at(-1);
    if (token) return kebab(token.split('__').at(-1));
  }

  const role = attr(node, sourceFile, 'role');
  if (role) return kebab(role);
  const handler = expressionAttr(node, sourceFile, 'onClick')
    ?? expressionAttr(node, sourceFile, 'onSubmit')
    ?? expressionAttr(node, sourceFile, 'onPointerDown')
    ?? expressionAttr(node, sourceFile, 'onKeyDown');
  if (handler) {
    const names = [...handler.matchAll(/\b(?:on|set|go|open|close|clear|dismiss|toggle|select|remove|retry|cancel|refresh|save|submit|commit|run|copy|download|include|exclude|rebuild)[A-Za-z0-9_]*/g)];
    if (names.length > 0) return kebab(names.at(-1)[0]);
  }
  const type = attr(node, sourceFile, 'type');
  return kebab(type ? `${type}-${tag}` : tag);
}

const used = new Set(registry.entries.map(entry => entry.id));
const patterns = new Set(registry.patterns.map(entry => entry.pattern));
const applied = [];

for (const [file, candidates] of Object.entries(Object.groupBy(registry.unresolvedCandidates, candidate => candidate.file))) {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const queues = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.line}:${candidate.element}`;
    const queue = queues.get(key) ?? [];
    queue.push(candidate);
    queues.set(key, queue);
  }
  const edits = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const queue = queues.get(`${line}:${tag}`);
      const candidate = queue?.shift();
      if (candidate) {
        const [area, component] = addressFor(file);
        const baseElement = descriptor(node, sourceFile, tag);
        let id = `${area}.${component}.${baseElement}`;
        let ordinal = 2;
        while (used.has(id) || patterns.has(`${id}-*`)) id = `${area}.${component}.${baseElement}-${ordinal++}`;

        const keyExpression = expressionAttr(node, sourceFile, 'key');
        const dynamic = keyExpression && !/^['"`]/u.test(keyExpression);
        const identity = dynamic ? `${id}-*` : id;
        if (dynamic) patterns.add(identity);
        else used.add(identity);
        const attribute = tag === 'Toggle' ? 'testId' : 'data-testid';
        const insertion = dynamic
          ? ` ${attribute}={\`${id}-\${${keyExpression}}\`}`
          : ` ${attribute}="${id}"`;
        edits.push({ position: node.tagName.end, insertion });
        applied.push({ candidate: candidate.id, file, line, tag, identity });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const unmatched = [...queues.values()].flat();
  if (unmatched.length > 0) throw new Error(`Could not locate ${unmatched.map(item => `${file}:${item.line}<${item.element}>`).join(', ')}`);
  let next = text;
  for (const edit of edits.sort((left, right) => right.position - left.position)) {
    next = `${next.slice(0, edit.position)}${edit.insertion}${next.slice(edit.position)}`;
  }
  fs.writeFileSync(file, next);
}

console.log(JSON.stringify({ applied: applied.length, identities: applied }, null, 2));
