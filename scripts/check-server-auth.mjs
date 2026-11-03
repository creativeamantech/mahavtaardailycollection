import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("src");
const exempt = new Set(["getLoginUsers", "loginWithPin", "getCurrentSession", "logoutCurrentSession"]);
const failures = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) inspect(full);
  }
}

function inspect(file) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const name = declaration.name.text;
        const block = declaration.initializer.getText(ast);
        if (block.includes("createServerFn(") && !exempt.has(name) && !block.includes("requireSession(")) {
          failures.push(`${file}: exported server function ${name} has no requireSession guard`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

walk(root);
if (failures.length) {
  console.error("Server-function authentication coverage failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}
console.log("Server-function authentication coverage passed.");
