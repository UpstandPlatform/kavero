"use client";

import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@Kavero/ui/components/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

/** Shadcn code block with the app's shared Shiki highlighter and copy action. */
export function HighlightedCodeBlock({ title, code, language }: { title: string; code: string; language: string }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions><CodeBlockCopyButton value={code} aria-label="Copy code" title="Copy code" /></CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-[32rem]" aria-label={`${title} code`}>
        {lines.map((line, index) => <span className="block min-h-lh" key={index}>{line}</span>)}
      </CodeBlockContent>
    </CodeBlock>
  );
}
