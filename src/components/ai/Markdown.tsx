import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, dependency-free markdown renderer for assistant answers.
 *
 * Deliberately supports only what the assistants emit — **bold**, `code`,
 * bullet lists, numbered lists, `###`/`**heading**` lines, simple pipe tables
 * and blank-line paragraphs. Nothing is rendered as raw HTML, so an answer can
 * never inject markup.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // **bold** or `code`
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-gray-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-900">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
    i += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

export function Markdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`k${key++}`} className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[18rem] border-collapse text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    scope="col"
                    className={`border-b border-gray-200 px-2 py-1.5 font-semibold text-gray-700 ${hi === 0 ? 'text-left' : 'text-right'}`}
                  >
                    {renderInline(h, `h${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-2 py-1.5 text-gray-700 ${ci === 0 ? 'text-left' : 'text-right tabular-nums'}`}>
                      {renderInline(cell, `c${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Heading (### or a line that is entirely bold)
    const headingMatch = /^#{1,4}\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push(
        <p key={`k${key++}`} className="text-sm font-semibold text-gray-900">
          {renderInline(headingMatch[1], `hd${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`k${key++}`} className="ml-4 list-disc space-y-1 marker:text-brand-500">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `u${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`k${key++}`} className="ml-4 list-decimal space-y-1 marker:text-brand-500">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `o${key}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph (consume until blank / list / table)
    const paragraph: string[] = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !isTableRow(lines[i])
      && !/^#{1,4}\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`k${key++}`} className="whitespace-pre-wrap">
        {renderInline(paragraph.join('\n'), `p${key}`)}
      </p>,
    );
  }

  return <div className="space-y-2 text-sm leading-relaxed text-gray-800">{blocks}</div>;
}
