"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Components } from "react-markdown";

/**
 * Markdown renderer for bounty descriptions.
 *
 * Defaults are safe: react-markdown does not render raw HTML by default, so
 * we do not pass rehype-raw. Custom link renderer opens in a new tab and
 * adds rel=noopener; styling matches the rest of the bounty detail view
 * (dark theme, white/70 prose, blue links).
 *
 * `remark-breaks` is enabled so single newlines inside paragraphs render
 * as `<br>` — this preserves line breaks for posters who write plain
 * text (matches GitHub/Slack/Discord behavior). Block-level Markdown
 * (headings, lists) is unaffected because those constructs are already
 * terminated by the newline.
 */

const components: Components = {
  // Destructure `node` (mdast AST) out of props so it doesn't get spread
  // onto the real <a> and trigger React's "Invalid DOM prop" warning.
  // The sr-only span gives screen-reader users a cue that the link
  // opens in a new tab — matches the standard a11y pattern.
  a: ({ node: _node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#7DA2FF] hover:text-[#9db8ff] underline underline-offset-2 break-all"
    >
      {children}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  ),
  // Demote Markdown headings one level: the bounty detail page already
  // has an <h1> for the bounty title, so Markdown `# Heading` (a second
  // <h1>) would skip the natural h1→h2 progression. Map h1→h2, h2→h3,
  // h3→h4, h4→h5; sizing stays the same, only the semantic tag shifts.
  h1: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold text-white/90 first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 text-[15px] font-semibold text-white/90 first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold text-white/85 first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-3 mb-1 text-sm font-medium text-white/85 first:mt-0">{children}</h5>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="text-white/70">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-white/20 pl-3 text-white/60">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = (className ?? "").startsWith("language-");
    if (isBlock) {
      return <code className="text-[12px] text-[#F7931A]">{children}</code>;
    }
    return (
      <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[12px] text-[#F7931A]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/30 p-3">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white/90">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-3 border-white/[0.08]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-left font-medium text-white/80">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-white/[0.08] px-2 py-1 text-white/70">{children}</td>
  ),
};

export default function BountyMarkdown({ children }: { children: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-white/70">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
