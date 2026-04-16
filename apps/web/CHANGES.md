# VetIOS UI/UX Readability Fix

## Files Changed

### 1. apps/web/app/globals.css
**Root cause fixed here.**
- `--muted-foreground` lifted: `0 0% 40%` → `0 0% 62%` (+22% lightness)
- `--background` lifted: `0 0% 0%` → `0 0% 4%` (pure black → deep dark)
- `--card` lifted: `0 0% 5%` → `0 0% 8%` (cards now visible vs bg)
- `--border` lifted: `0 0% 12%` → `0 0% 20%` (grid lines now visible)
- `--secondary` lifted: `0 0% 10%` → `0 0% 13%` (hover states visible)
- Added `.animate-blink` keyframe for cursor effect
- Added `.text-label`, `.text-data`, `.console-section-title` utilities

### 2. apps/web/components/Sidebar.tsx
- Nav item default state: `text-muted` (40%) → `text-[hsl(0_0%_58%)]`
- Nav item hover state: `text-foreground` → `text-[hsl(0_0%_84%)]`
- Active item: keeps accent green + adds left border + right dot indicator
- Section label added: "Navigation" above nav items
- System status text lifted: labels now `hsl(0 0% 42%)`, value stays accent green
- Background: `bg-dim` → explicit `bg-[hsl(0_0%_6%)]`

### 3. apps/web/components/AppShell.tsx
- Topbar background: `bg-background` → `bg-[hsl(0_0%_6%)]`
- Topbar border: `border-grid` → `border-[hsl(0_0%_18%)]`
- Page title shown in topbar center (derived from pathname)
- Blinking cursor `█` added after page title
- Back button: `text-muted` → `text-[hsl(0_0%_52%)]` with visible hover
- Back button becomes `ChevronLeft` for cleaner look

### 4. apps/web/components/UserNav.tsx
- Email: `text-muted` → `text-[hsl(0_0%_52%)]` (readable but subdued)
- Loading state: `text-muted` → `text-[hsl(0_0%_35%)]`
- Sign Out: adds `LogOut` icon, hover turns red-toned
- Vertical divider added between email and sign out

### 5. apps/web/components/ui/terminal.tsx
- `TerminalLabel`: `text-muted` → `text-[hsl(0_0%_65%)]`
- `TerminalInput`: background lifted, placeholder lifted to `hsl(0_0%_38%)`
- `PageHeader` h1: `text-foreground` explicitly, size stays same
- `PageHeader` description: `text-muted text-xs` → `text-[hsl(0_0%_58%)] text-[12px]`
- `DataRow` label: `text-[10px] text-muted` → `text-[11px] text-[hsl(0_0%_52%)]`
- `DataRow` value: `text-xs` → `text-[12px] text-[hsl(0_0%_86%)]`
- `ConsoleCard` title: `text-muted` → `text-[hsl(0_0%_72%)]`
- `ConsoleCard` background: `bg-background` → `bg-[hsl(0_0%_8%)]`
- `ConsoleCard` border: `border-grid` → `border-[hsl(0_0%_18%)]`
- `TerminalTabs` inactive: `text-muted` → `text-[hsl(0_0%_52%)]`
- `TerminalButton` secondary: `text-muted` → `text-[hsl(0_0%_68%)]`

### 6. apps/web/components/DashboardControlPlaneClient.tsx
- Operation card labels: `text-muted` → `text-[hsl(0_0%_64%)]`
- Edge Ops card: removed danger/red border, now matches other cards
- `MetricCard` label: `text-muted` → `text-[hsl(0_0%_58%)]`
- `MetricCard` detail: `text-muted` → `text-[hsl(0_0%_55%)]`
- `DataPanel` label: `text-muted` → `text-[hsl(0_0%_60%)]`
- `DataPanel` border/bg: `border-grid bg-black/20` → visible card style
- `AlertRow` message: `text-muted` → `text-[hsl(0_0%_60%)]`
- `EmptyChartState`: `text-muted` → `text-[hsl(0_0%_48%)]`
- Footer timestamps: `text-muted` → `text-[hsl(0_0%_52%)]`

## How to Apply

Copy each file to the exact path shown above in your VetIOS repo.
No dependency changes required. No new packages needed.
