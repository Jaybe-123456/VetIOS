const fs = require('fs');

const file = 'apps/web/components/AppShell.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /{[/][*] Left: hamburger [+] branding on mobile [*][/]}[\s\S]*?{[/][*] Spacer for desktop [(]sidebar provides branding[)] [*][/]}\s*<div className="hidden lg:block" \/>/;

const repl = `{/* Left: hamburger + branding on mobile, and back button */}
                    <div className="flex items-center gap-2 lg:gap-4">
                        <div className="flex items-center gap-3 lg:hidden">
                            <button
                                onClick={handleToggle}
                                className="p-2 -ml-2 text-muted hover:text-accent transition-colors"
                                aria-label="Toggle sidebar"
                            >
                                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </button>
                            <span className="font-mono flex items-center gap-1.5 font-bold tracking-tight text-accent text-sm mr-1">
                                <TerminalSquare className="w-4 h-4" />
                                VET_IOS
                            </span>
                        </div>

                        {/* Back Button */}
                        <button
                            onClick={() => router.back()}
                            className="flex items-center gap-1.5 p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-muted hover:text-accent hover:bg-muted/10 transition-all text-sm font-medium group"
                            aria-label="Go back"
                            title="Go back"
                        >
                            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                            <span className="hidden sm:inline">Back</span>
                        </button>
                    </div>

                    {/* Spacer for desktop */}
                    <div className="hidden lg:block flex-1" />`;

content = content.replace(regex, repl);
fs.writeFileSync(file, content);
console.log("Patched successfully");
