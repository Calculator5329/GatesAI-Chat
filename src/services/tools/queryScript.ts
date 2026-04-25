import type { Tool } from './types';

type QueryTemplateAction = 'template_python_csv_query' | 'template_json_query' | 'template_artifact_audit';

export const queryScriptTool: Tool = {
  def: {
    name: 'query_script',
    description: [
      'Return organized query-script templates for repeatable data work.',
      '',
      'Use this after checking /workspace/artifacts and inspecting source files. It provides recipes only; execute scripts with terminal cmd "python" and explicit argv, never shell pipes or redirects.',
      '',
      'Actions:',
      '- `template_python_csv_query` - Python CSV analysis script layout.',
      '- `template_json_query` - Python JSON artifact/source query layout.',
      '- `template_artifact_audit` - validation script layout for generated artifacts.',
      '',
      'Convention: scripts live under /workspace/notes/query_scripts/<topic>.py and final reusable outputs live under /workspace/artifacts/<topic>.json.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['template_python_csv_query', 'template_json_query', 'template_artifact_audit'] },
        topic: { type: 'string', description: 'Short topic used to derive script and artifact filenames.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'workspace',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 6_000, summarizeLargeOutput: false },
  },

  async execute(args) {
    const action = typeof args.action === 'string' ? args.action as QueryTemplateAction : '';
    const slug = slugTopic(typeof args.topic === 'string' ? args.topic : 'data_query');

    switch (action) {
      case 'template_python_csv_query':
        return csvTemplate(slug);
      case 'template_json_query':
        return jsonTemplate(slug);
      case 'template_artifact_audit':
        return auditTemplate(slug);
      default:
        return 'Error: `action` is required for query_script. Valid: template_python_csv_query, template_json_query, template_artifact_audit.';
    }
  },
};

function csvTemplate(slug: string): string {
  return [
    `script: /workspace/notes/query_scripts/${slug}.py`,
    `artifact: /workspace/artifacts/${slug}.json`,
    '',
    'Workflow:',
    '1. Use inspect_file({ action: "workspace_profile" }) and inspect_file profiles/previews first.',
    '2. Use cwd-relative source paths such as attachments/export.csv inside scripts.',
    `3. Write this script to notes/query_scripts/${slug}.py with fs.write.`,
    `4. Run with terminal({ cmd: "python", args: ["notes/query_scripts/${slug}.py"] }).`,
    `5. Read artifacts/${slug}.json or inspect_file it before answering.`,
    '',
    'Template:',
    '```python',
    'import csv',
    'import json',
    'from pathlib import Path',
    '',
    'root = Path.cwd()',
    'source = root / "attachments" / "REPLACE_WITH_SOURCE.csv"',
    `artifact = root / "artifacts" / "${slug}.json"`,
    '',
    'rows = list(csv.DictReader(source.open(newline="", encoding="utf-8-sig")))',
    '# validate counts/schema/ranges before reporting',
    'required = {"REPLACE_WITH_COLUMN"}',
    'missing = required - set(rows[0].keys() if rows else [])',
    'if missing:',
    '    raise SystemExit(f"missing required columns: {sorted(missing)}")',
    '',
    'result = {',
    '    "source": str(source.relative_to(root)),',
    '    "row_count": len(rows),',
    '    "sample": rows[:5],',
    '    "validation": {"required_columns": sorted(required), "missing": sorted(missing)},',
    '}',
    'artifact.parent.mkdir(parents=True, exist_ok=True)',
    'artifact.write_text(json.dumps(result, indent=2), encoding="utf-8")',
    'print(json.dumps({"artifact": str(artifact.relative_to(root)), "row_count": len(rows)}))',
    '```',
  ].join('\n');
}

function jsonTemplate(slug: string): string {
  return [
    `script: /workspace/notes/query_scripts/${slug}.py`,
    `artifact: /workspace/artifacts/${slug}.json`,
    '',
    'Template:',
    '```python',
    'import json',
    'from pathlib import Path',
    '',
    'root = Path.cwd()',
    'source = root / "artifacts" / "REPLACE_WITH_SOURCE.json"',
    `artifact = root / "artifacts" / "${slug}.json"`,
    'data = json.loads(source.read_text(encoding="utf-8-sig"))',
    '',
    '# validate expected shape before deriving answers',
    'if not isinstance(data, (dict, list)):',
    '    raise SystemExit("unexpected JSON root")',
    '',
    'result = {"source": str(source.relative_to(root)), "root_type": type(data).__name__}',
    'artifact.parent.mkdir(parents=True, exist_ok=True)',
    'artifact.write_text(json.dumps(result, indent=2), encoding="utf-8")',
    'print(json.dumps({"artifact": str(artifact.relative_to(root))}))',
    '```',
  ].join('\n');
}

function auditTemplate(slug: string): string {
  const artifactSlug = slug.endsWith('_audit') ? slug : `${slug}_audit`;
  return [
    `script: /workspace/notes/query_scripts/${artifactSlug}.py`,
    `artifact: /workspace/artifacts/${artifactSlug}.json`,
    '',
    'Template:',
    '```python',
    'import json',
    'from pathlib import Path',
    '',
    'root = Path.cwd()',
    'artifacts = sorted((root / "artifacts").glob("*.json"))',
    'audit = []',
    'for path in artifacts:',
    '    try:',
    '        value = json.loads(path.read_text(encoding="utf-8-sig"))',
    '        audit.append({"path": str(path.relative_to(root)), "ok": True, "root_type": type(value).__name__})',
    '    except Exception as exc:',
    '        audit.append({"path": str(path.relative_to(root)), "ok": False, "error": str(exc)})',
    '',
    `out = root / "artifacts" / "${artifactSlug}.json"`,
    'out.write_text(json.dumps({"artifact_count": len(audit), "files": audit}, indent=2), encoding="utf-8")',
    'print(json.dumps({"artifact": str(out.relative_to(root)), "artifact_count": len(audit)}))',
    '```',
  ].join('\n');
}

function slugTopic(topic: string): string {
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'data_query';
}
