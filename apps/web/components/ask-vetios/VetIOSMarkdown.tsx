'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// ── Section icon map ──────────────────────────────────────────────────────────
const SECTION_ICONS: Record<string, string> = {
  // Classification / Structure
  'classification': '🧬',
  'structure': '🔬',
  'taxonomy': '🔬',
  'genome': '🧬',
  // Epidemiology / Transmission
  'epidemiology': '🌍',
  'transmission': '📡',
  'host range': '🐾',
  // Pathogenesis
  'pathogenesis': '⚡',
  'mechanism': '⚙️',
  'pathophysiology': '🔴',
  'cellular': '🦠',
  // Clinical
  'clinical': '🩺',
  'signs': '🩺',
  'symptoms': '🩺',
  'manifestation': '🩺',
  // Diagnosis
  'diagnosis': '🔍',
  'diagnostic': '🔍',
  'laboratory': '🧪',
  'lab': '🧪',
  'imaging': '📷',
  // Treatment
  'treatment': '💊',
  'therapy': '💊',
  'management': '💊',
  // Prevention
  'prevention': '🛡️',
  'vaccine': '💉',
  'vaccination': '💉',
  'control': '🛡️',
  // Immune
  'immune': '🛡️',
  'immunity': '🛡️',
  // Prognosis
  'prognosis': '📊',
  'outcome': '📊',
  'severity': '⚠️',
  // Neuro
  'neuro': '🧠',
  'brain': '🧠',
  'cns': '🧠',
  'demyelination': '🧠',
  // Takeaways
  'key': '💡',
  'summary': '📋',
  'takeaway': '💡',
  'conclusion': '📋',
  'overview': '📋',
};

function getSectionIcon(heading: string): string {
  const lower = heading.toLowerCase();
  for (const [keyword, icon] of Object.entries(SECTION_ICONS)) {
    if (lower.includes(keyword)) return icon;
  }
  // Number-prefixed sections get sequential science icons
  if (/^\d+\./.test(heading.trim())) {
    const icons = ['🔬', '🌍', '🧬', '⚡', '🦠', '🩺', '🔍', '🧪', '💊', '🛡️', '📊', '🧠', '💡'];
    const num = parseInt(heading.trim()) - 1;
    return icons[num % icons.length];
  }
  return '▸';
}

// ── Token types ───────────────────────────────────────────────────────────────
type Token =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'bullet'; text: string; level: number }
  | { type: 'bold_line'; text: string }
  | { type: 'divider' }
  | { type: 'text'; text: string }
  | { type: 'blank' };

// ── Inline formatter — handles **bold**, *italic*, `code` ─────────────────────
function InlineText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const tokens: Array<{ type: 'text' | 'bold' | 'italic' | 'code'; content: string }> = [];
    let remaining = text;
    while (remaining.length > 0) {
      // **bold**
      const boldMatch = remaining.match(/^([\s\S]*?)\*\*(.+?)\*\*([\s\S]*)/)  ;
      if (boldMatch) {
        if (boldMatch[1]) tokens.push({ type: 'text', content: boldMatch[1] });
        tokens.push({ type: 'bold', content: boldMatch[2] });
        remaining = boldMatch[3];
        continue;
      }
      // *italic*
      const italicMatch = remaining.match(/^([\s\S]*?)\*(.+?)\*([\s\S]*)/)  ;
      if (italicMatch) {
        if (italicMatch[1]) tokens.push({ type: 'text', content: italicMatch[1] });
        tokens.push({ type: 'italic', content: italicMatch[2] });
        remaining = italicMatch[3];
        continue;
      }
      // `code`
      const codeMatch = remaining.match(/^([\s\S]*?)`(.+?)`([\s\S]*)/)  ;
      if (codeMatch) {
        if (codeMatch[1]) tokens.push({ type: 'text', content: codeMatch[1] });
        tokens.push({ type: 'code', content: codeMatch[2] });
        remaining = codeMatch[3];
        continue;
      }
      tokens.push({ type: 'text', content: remaining });
      break;
    }
    return tokens;
  }, [text]);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.type === 'bold') return <strong key={i} className="font-semibold text-white">{part.content}</strong>;
        if (part.type === 'italic') return <em key={i} className="italic text-white/80">{part.content}</em>;
        if (part.type === 'code') return <code key={i} className="px-1.5 py-0.5 bg-white/10 rounded text-accent text-[11px] font-mono">{part.content}</code>;
        return <span key={i}>{part.content}</span>;
      })}
    </span>
  );
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────
function tokenise(content: string): Token[] {
  const lines = content.split('\n');
  const tokens: Token[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Blank
    if (!line.trim()) { tokens.push({ type: 'blank' }); continue; }

    // Dividers
    if (/^[-*_]{3,}$/.test(line.trim())) { tokens.push({ type: 'divider' }); continue; }

    // H1 — # heading or ALL CAPS line (short)
    if (line.startsWith('# ')) { tokens.push({ type: 'h1', text: line.slice(2) }); continue; }

    // H2
    if (line.startsWith('## ')) { tokens.push({ type: 'h2', text: line.slice(3) }); continue; }

    // H3
    if (line.startsWith('### ')) { tokens.push({ type: 'h3', text: line.slice(4) }); continue; }

    // Numbered section headings: "1. Classification and Structure"
    if (/^\d+\.\s+[A-Z]/.test(line) && !line.includes('*') && line.length < 80) {
      tokens.push({ type: 'h2', text: line }); continue;
    }

    // Bullet — * or - or •, nested indent
    const bulletMatch = line.match(/^(\s*)[*\-•]\s+(.*)/);
    if (bulletMatch) {
      const level = Math.floor(bulletMatch[1].length / 2);
      tokens.push({ type: 'bullet', text: bulletMatch[2], level }); continue;
    }

    // Bold-only line (e.g. "**Key Section**")
    if (/^\*\*[^*]+\*\*:?\s*$/.test(line.trim())) {
      tokens.push({ type: 'bold_line', text: line.trim().replace(/^\*\*|\*\*:?$/g, '') }); continue;
    }

    // Arrow/emoji-prefixed bold lines like "👉 The H protein..."
    if (/^(👉|→|▶|✅|❌|⚠️|💡)\s+/.test(line)) {
      tokens.push({ type: 'h3', text: line }); continue;
    }

    // Regular paragraph text
    tokens.push({ type: 'text', text: line });
  }

  return tokens;
}

// ── Main renderer ─────────────────────────────────────────────────────────────
interface VetIOSMarkdownProps {
  content: string;
  queryType?: 'clinical' | 'educational' | 'general';
}

export default function VetIOSMarkdown({ content, queryType = 'general' }: VetIOSMarkdownProps) {
  const tokens = useMemo(() => tokenise(content), [content]);

  // Group consecutive bullets into lists
  type Group =
    | { kind: 'token'; token: Token }
    | { kind: 'list'; items: Array<{ text: string; level: number }> };

  const groups: Group[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'bullet') {
      const list: Array<{ text: string; level: number }> = [];
      while (i < tokens.length && tokens[i].type === 'bullet') {
        const b = tokens[i] as { type: 'bullet'; text: string; level: number };
        list.push({ text: b.text, level: b.level });
        i++;
      }
      groups.push({ kind: 'list', items: list });
    } else {
      groups.push({ kind: 'token', token: t });
      i++;
    }
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {groups.map((group, gi) => {
        if (group.kind === 'list') {
          return (
            <ul key={gi} className="space-y-1.5 ml-1">
              {group.items.map((item, ii) => (
                <li
                  key={ii}
                  className={cn(
                    'flex items-start gap-2.5 text-sm leading-relaxed',
                    item.level === 0 ? 'ml-0' : item.level === 1 ? 'ml-5' : 'ml-9'
                  )}
                >
                  <span className={cn(
                    'mt-1.5 shrink-0 rounded-full',
                    item.level === 0
                      ? 'w-1.5 h-1.5 bg-accent/70'
                      : item.level === 1
                      ? 'w-1 h-1 bg-white/40'
                      : 'w-1 h-1 bg-white/20'
                  )} />
                  <InlineText text={item.text} className="text-white/85" />
                </li>
              ))}
            </ul>
          );
        }

        const { token } = group;

        if (token.type === 'blank') return <div key={gi} className="h-1" />;

        if (token.type === 'divider') return (
          <div key={gi} className="border-t border-white/8 my-4" />
        );

        if (token.type === 'h1') return (
          <div key={gi} className="flex items-center gap-3 mt-6 mb-3 pb-2 border-b border-white/10">
            <span className="text-xl">{getSectionIcon(token.text)}</span>
            <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
              <InlineText text={token.text} />
            </h1>
          </div>
        );

        if (token.type === 'h2') return (
          <div key={gi} className="flex items-center gap-2.5 mt-5 mb-2">
            <span className="text-base leading-none">{getSectionIcon(token.text)}</span>
            <h2 className="text-sm font-semibold text-white/95 tracking-tight uppercase">
              <InlineText text={token.text} />
            </h2>
          </div>
        );

        if (token.type === 'h3') return (
          <div key={gi} className="flex items-start gap-2 mt-3 mb-1 pl-1">
            <h3 className="text-[13px] font-semibold text-accent/90 leading-snug">
              <InlineText text={token.text} />
            </h3>
          </div>
        );

        if (token.type === 'bold_line') return (
          <div key={gi} className="flex items-center gap-2 mt-3 mb-1">
            <span className="w-0.5 h-4 bg-accent/50 rounded-full shrink-0" />
            <p className="text-[13px] font-semibold text-white/95">
              <InlineText text={token.text} />
            </p>
          </div>
        );

        if (token.type === 'text') {
          // Detect callout lines — lines starting with emoji
          const emojiCallout = /^(🔑|💡|⚠️|🚨|✅|❌|📌|👉|🧠|🩺|🔬|🧬|💊|🛡️|📊|⚡)\s+/.test(token.text);
          if (emojiCallout) {
            return (
              <div key={gi} className="flex items-start gap-2 py-2 px-3 bg-white/[0.04] border border-white/8 rounded-sm mt-2">
                <InlineText text={token.text} className="text-sm text-white/90 leading-relaxed" />
              </div>
            );
          }

          return (
            <p key={gi} className="text-sm text-white/80 leading-relaxed">
              <InlineText text={token.text} />
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}
