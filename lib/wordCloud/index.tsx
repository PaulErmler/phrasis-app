'use client';

import {
  useRef,
  useLayoutEffect,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { Word, WordRendererData } from '@isoterik/react-word-cloud';

export const WORD_CLOUD_COLORS = [
  'oklch(0.7162 0.119 217.31)', // primary blue
  'oklch(0.6189 0.1636 40.89)', // accent orange
  'oklch(0.8179 0.1705 77.95)', // warning yellow
];

export function buildWords(wordList: string[]): Word[] {
  return wordList.map((text, i) => ({
    text,
    value: wordList.length - i,
  }));
}

export function StaticWordRenderer(
  data: WordRendererData,
  ref?: Ref<SVGTextElement>,
) {
  const { index, onWordClick, onWordMouseOver, onWordMouseOut, ...word } = data;
  return (
    <text
      ref={ref}
      textAnchor="middle"
      transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
      style={{
        fontFamily: word.font,
        fontStyle: word.style,
        fontWeight: word.weight,
        fontSize: `${word.size}px`,
        fill: word.fill,
        transition: word.transition,
        cursor: onWordClick ? 'pointer' : 'text',
      }}
      onClick={(event) => onWordClick?.(word, index, event)}
      onMouseOver={(event) => onWordMouseOver?.(word, index, event)}
      onMouseOut={(event) => onWordMouseOut?.(word, index, event)}
    >
      {word.text}
    </text>
  );
}

/** Watch a container's rect and return current pixel dimensions. Used by
 * both the app and landing word clouds to keep the SVG sized to its box. */
export function useCloudSize(): {
  ref: RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setSize({ width: Math.round(w), height: Math.round(h) });
      }
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        apply(cr.width, cr.height);
      }
    });
    ro.observe(el);

    const r = el.getBoundingClientRect();
    apply(r.width, r.height);

    return () => ro.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}

/** Highlight whole-word occurrences of `word` inside `text`. Used by
 * sentence-example dialogs on both the stats page and the landing page. */
export function highlightWord(text: string, word: string): React.ReactNode {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Capture group makes split() interleave non-matches and matches: even
  // indices are surrounding text, odd indices are the matched word. Avoid
  // `/g` here since a stateful regex shared with .test() carries lastIndex
  // across calls and mis-classifies parts.
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`,
    'iu',
  );
  const parts = text.split(regex);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
