'use client';

import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { SHORTCUTS, shortcutFor, type ShortcutAction } from '@/lib/studio/shortcuts';
import { Search } from 'lucide-react';

export interface PaletteCommand {
  /** Stable id; usually mirrors the shortcut action when there is one. */
  id: string;
  label: string;
  /** Optional shortcut binding to render the keybinding hint. */
  shortcut?: ShortcutAction;
  /** Optional second line under the label. */
  hint?: string;
  /** Group for the cmdk UI. */
  group: string;
  /** Executed when chosen. */
  run: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
}

/**
 * Linear / VS Code style command palette built on cmdk.
 *
 * Renders a centered overlay with fuzzy search across all commands.
 * Keyboard: ↑/↓ navigate, ↵ run, Esc close, ⌘K toggle.
 */
export function CommandPalette({ open, onOpenChange, commands }: Props) {
  const [value, setValue] = useState<string>('');

  useEffect(() => {
    if (!open) setValue('');
  }, [open]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed inset-0 z-50 grid place-items-start pt-[14vh] backdrop-blur-sm bg-text-primary/40"
      contentClassName="w-[min(92vw,640px)] mx-auto rounded-2xl border border-editor-border bg-editor-panel text-editor-text shadow-lift overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-editor-border px-4">
        <Search className="h-4 w-4 text-editor-muted" aria-hidden />
        <Command.Input
          value={value}
          onValueChange={setValue}
          autoFocus
          placeholder="Search commands…"
          className="flex-1 bg-transparent py-3.5 text-sm text-editor-text placeholder:text-editor-muted focus:outline-none"
        />
        <span className="chip border-editor-border bg-transparent text-editor-muted text-2xs">
          Esc
        </span>
      </div>
      <Command.List className="max-h-[55vh] overflow-y-auto px-2 py-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-editor-muted">
          Nothing matched <span className="font-mono">{value}</span>.
        </Command.Empty>

        {Array.from(new Set(commands.map((c) => c.group))).map((group) => (
          <Command.Group
            key={group}
            heading={group}
            className="text-2xs font-semibold uppercase tracking-[0.16em] text-editor-muted px-2 pt-2"
          >
            {commands
              .filter((c) => c.group === group)
              .map((c) => {
                const sc = c.shortcut ? shortcutFor(c.shortcut) : undefined;
                return (
                  <Command.Item
                    key={c.id}
                    value={`${c.group} ${c.label} ${c.hint ?? ''}`}
                    onSelect={() => {
                      onOpenChange(false);
                      c.run();
                    }}
                    className="group flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm aria-selected:bg-editor-selection aria-selected:text-editor-text"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{c.label}</span>
                      {c.hint && (
                        <span className="text-2xs text-editor-muted">{c.hint}</span>
                      )}
                    </div>
                    {sc && (
                      <kbd className="font-mono text-2xs text-editor-muted group-aria-selected:text-editor-text">
                        {sc.label}
                      </kbd>
                    )}
                  </Command.Item>
                );
              })}
          </Command.Group>
        ))}

        <Command.Group
          heading="Help"
          className="text-2xs font-semibold uppercase tracking-[0.16em] text-editor-muted px-2 pt-2"
        >
          <Command.Item
            value="Help All shortcuts"
            disabled
            className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-editor-muted"
          >
            <span>{SHORTCUTS.length} shortcuts wired</span>
            <kbd className="font-mono text-2xs">?</kbd>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
