import type { ReactNode } from 'react';

/** Renders the small Markdown subset used by the assistant's answers. */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\$[^$]+\$)/g).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    return <span key={key}>{part}</span>;
  });
}

export function AiChatMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5">
        {items.map((item, index) => (
          <li key={index}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
  };

  const flushCode = () => {
    if (codeLines.length === 0) return;
    const code = codeLines.join('\n');
    codeLines = [];
    blocks.push(
      <pre key={`pre-${blocks.length}`} className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">
        <code>{code}</code>
      </pre>,
    );
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      flushBullets();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        codeLines = [];
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (line.trim().startsWith('$$')) {
      flushBullets();
      const formula = line.trim().replace(/\$\$/g, '');
      blocks.push(
        <div key={`math-${index}`} className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700">
          {formula}
        </div>,
      );
      return;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      flushBullets();
      blocks.push(
        <h4 key={`h-${index}`} className="mb-1 mt-2 text-sm font-bold text-slate-900">
          {renderInline(line.replace(/^#{2,3}\s*/, ''), `h-${index}`)}
        </h4>,
      );
      return;
    }
    const bullet = line.match(/^\s*(?:•|-)\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    flushBullets();
    if (line.trim() === '') return;
    blocks.push(
      <p key={`p-${index}`} className="my-1 leading-relaxed">
        {renderInline(line, `p-${index}`)}
      </p>,
    );
  });

  flushBullets();
  flushCode();

  return <div className="text-sm text-slate-700">{blocks}</div>;
}

export default AiChatMarkdown;
