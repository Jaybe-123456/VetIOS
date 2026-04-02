const fs = require('fs');

const file = 'apps/web/components/AppShell.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports
content = content.replace("import { usePathname } from 'next/navigation';", "import { usePathname, useRouter } from 'next/navigation';");
content = content.replace("import { Menu, X, TerminalSquare } from 'lucide-react';", "import { Menu, X, TerminalSquare, ArrowLeft } from 'lucide-react';");

// Replace initialization
content = content.replace("const pathname = usePathname();\r\n\r\n    const handleToggle", "const pathname = usePathname();\r\n    const router = useRouter();\r\n\r\n    const handleToggle");
content = content.replace("const pathname = usePathname();\n\n    const handleToggle", "const pathname = usePathname();\n    const router = useRouter();\n\n    const handleToggle");

fs.writeFileSync(file, content);
console.log("Patched imports correctly.");
