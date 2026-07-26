import React, { ReactNode } from "react";

type TextSegment = {
  type: "text" | "bold" | "italic" | "strikethrough" | "monospace" | "link";
  content: string;
  url?: string;
};

/**
 * Validates that a URL is safe (only http/https protocols)
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses WhatsApp-style formatted text into segments.
 * Supports: *bold*, _italic_, ~strikethrough~, `monospace`, [text](url), and \n newlines
 */
export function parseMessageText(text: string): TextSegment[] {
  if (!text) return [];

  const segments: TextSegment[] = [];

  // Combined regex pattern for all formatting types
  // Order matters: links must be matched before other patterns to avoid conflicts
  const pattern =
    /\[([^\]]+)\]\(([^)]+)\)|\*([^*]+)\*|_([^_]+)_|~([^~]+)~|`([^`]+)`/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add any plain text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    // Determine which pattern matched
    if (match[1] !== undefined && match[2] !== undefined) {
      // Link: [text](url)
      const url = match[2];
      if (isValidUrl(url)) {
        segments.push({
          type: "link",
          content: match[1],
          url: url,
        });
      } else {
        // Invalid URL - render as plain text
        segments.push({
          type: "text",
          content: match[0],
        });
      }
    } else if (match[3] !== undefined) {
      // Bold: *text*
      segments.push({
        type: "bold",
        content: match[3],
      });
    } else if (match[4] !== undefined) {
      // Italic: _text_
      segments.push({
        type: "italic",
        content: match[4],
      });
    } else if (match[5] !== undefined) {
      // Strikethrough: ~text~
      segments.push({
        type: "strikethrough",
        content: match[5],
      });
    } else if (match[6] !== undefined) {
      // Monospace: `text`
      segments.push({
        type: "monospace",
        content: match[6],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining plain text
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Renders a text segment to a React element with appropriate styling
 */
function renderSegment(segment: TextSegment, key: number): ReactNode {
  switch (segment.type) {
    case "bold":
      return (
        <strong key={key} className="font-semibold">
          {segment.content}
        </strong>
      );
    case "italic":
      return (
        <em key={key} className="italic">
          {segment.content}
        </em>
      );
    case "strikethrough":
      return (
        <del key={key} className="line-through">
          {segment.content}
        </del>
      );
    case "monospace":
      return (
        <code
          key={key}
          className="px-1 py-0.5 rounded bg-[rgb(var(--bg-secondary)/var(--bg-secondary-opacity))] font-mono text-xs"
        >
          {segment.content}
        </code>
      );
    case "link":
      return (
        <a
          key={key}
          href={segment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link text-[rgb(var(--accent-primary))] hover:underline"
        >
          {segment.content}
        </a>
      );
    case "text":
    default:
      return <React.Fragment key={key}>{segment.content}</React.Fragment>;
  }
}

/**
 * Formats message text with WhatsApp-style formatting and renders as React elements.
 * Handles newlines by splitting into lines and inserting <br /> elements.
 */
export function formatMessage(text: string): ReactNode[] {
  if (!text) return [];

  // First, split by newlines
  const lines = text.split("\n");
  const result: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    // Parse each line for formatting
    const segments = parseMessageText(line);

    // Render segments for this line
    segments.forEach((segment, segmentIndex) => {
      result.push(renderSegment(segment, lineIndex * 1000 + segmentIndex));
    });

    // Add line break between lines (but not after the last line)
    if (lineIndex < lines.length - 1) {
      result.push(<br key={`br-${lineIndex}`} />);
    }
  });

  return result;
}
