// Shared helpers for the i18n coverage checker (i18n-check.mjs) and the
// hardcoded-string auditor (i18n-audit.mjs). Uses the real TypeScript
// compiler API (already a project devDependency) to parse source files as an
// AST rather than with regexes, so quoting/escaping/apostrophes inside
// translated strings never trip up extraction.
import ts from 'typescript';
import fs from 'node:fs';

export function parseSourceFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Extracts `const <name> = { key: 'value', ... }` object literals from a
 * source file into a plain JS object. Only string-literal / template
 * (no-substitution) values are captured — anything else (spreads, computed
 * values, nested objects) is recorded in `.__nonString` so callers can
 * decide how to treat it, rather than silently mis-reading it as a string.
 */
export function extractStringRecordLiterals(sourceFile, names) {
  const wanted = new Set(names);
  const found = {};
  for (const name of names) found[name] = { values: {}, nonString: [], spreadNames: [] };

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && wanted.has(node.name.text)) {
      const varName = node.name.text;
      if (node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        readObjectLiteral(node.initializer, found[varName]);
      }
    }
    ts.forEachChild(node, visit);
  }

  function readObjectLiteral(obj, bucket) {
    for (const prop of obj.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (ts.isIdentifier(prop.expression)) bucket.spreadNames.push(prop.expression.text);
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) continue;
      let key;
      if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) key = prop.name.text;
      else continue;
      const init = prop.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        bucket.values[key] = init.text;
      } else {
        bucket.nonString.push(key);
      }
    }
  }

  visit(sourceFile);
  return found;
}
