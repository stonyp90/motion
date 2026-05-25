'use client';

import { Activity, Sun, Moon, Zap } from 'lucide-react';
import { useTheme } from '@/lib/studio/theme';
import { shortcutFor } from '@/lib/studio/shortcuts';

interface Props {
  preset: string;
  frame: number;
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  editCount: number;
  editsPerMin: number;
}

/**
 * Bottom status bar — VS Code / Linear style.
 *
 * One row, monospace runtime metrics on the left, controls on the
 * right. Keeps the canvas area visually framed.
 */
export function StatusBar({
  preset,
  frame,
  totalFrames,
  fps,
  width,
  height,
  editCount,
  editsPerMin,
}: Props) {
  const { theme, toggle } = useTheme();
  const themeShortcut = shortcutFor('theme.toggle');

  return (
    <footer className="flex h-7 items-center justify-between gap-4 border-t border-editor-border bg-editor-toolbar px-3 font-mono text-2xs text-editor-muted">
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="flex items-center gap-1.5 text-editor-accent">
          <Activity className="h-3 w-3" />
          live
        </span>
        <Sep />
        <Metric label="preset" value={preset} />
        <Sep />
        <Metric label="frame" value={`${frame.toString().padStart(3, '0')}/${totalFrames}`} />
        <Sep />
        <Metric label="fps" value={fps.toFixed(0)} />
        <Sep />
        <Metric label="canvas" value={`${width}×${height}`} />
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden sm:inline">
          {editCount} edits ·{' '}
          <span className="text-editor-accent">{editsPerMin}/min</span>
        </span>
        <Sep />
        <span className="hidden md:flex items-center gap-1 text-editor-muted">
          <Zap className="h-3 w-3 text-editor-accent" />
          edge-rendered
        </span>
        <Sep />
        <button
          type="button"
          onClick={toggle}
          aria-label={themeShortcut ? `Toggle theme (${themeShortcut.label})` : 'Toggle theme'}
          title={themeShortcut?.label}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-editor-bg hover:text-editor-text"
        >
          {theme === 'dark' ? (
            <Moon className="h-3 w-3" />
          ) : (
            <Sun className="h-3 w-3" />
          )}
          {theme}
        </button>
      </div>
    </footer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-editor-muted">{label}:</span>
      <span className="text-editor-text">{value}</span>
    </span>
  );
}

function Sep() {
  return <span aria-hidden className="text-editor-border">·</span>;
}
