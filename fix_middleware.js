const fs = require('fs');

const file = 'apps/web/middleware.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /if\s*\(hasAuthCookie\s*&&\s*\(pathname\s*===\s*'\/login'\s*\|\|\s*pathname\s*===\s*'\/signup'\)\)\s*\{[\s\S]*?return\s*NextResponse\.redirect\(appUrl\);\s*\}/g;

const replacement = `// Removed hasAuthCookie redirection to prevent infinite loop on invalid sessions.
    // The actual /login route will rely on its client/server auth guards to verify session validity.`;

content = content.replace(regex, replacement);

fs.writeFileSync(file, content);
console.log("Patched middleware successfully.");
