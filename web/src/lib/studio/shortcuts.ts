/**
 * Keyboard shortcut spec for the studio.
 *
 * One source of truth — the studio renders these into tooltips, the
 * command palette uses them as default bindings, and the document
 * key-handler dispatches off the same map.
 */

export type ShortcutAction =
  | 'palette.open'
  | 'palette.close'
  | 'play.toggle'
  | 'panel.layers.toggle'
  | 'panel.inspector.toggle'
  | 'panel.timeline.toggle'
  | 'theme.toggle'
  | 'preset.next'
  | 'preset.prev'
  | 'export.lottie'
  | 'help.shortcuts';

export interface Shortcut {
  action: ShortcutAction;
  /** Display string for tooltips, e.g. "⌘K" or "Space". */
  label: string;
  /** Keys to match against KeyboardEvent.key — case-insensitive. */
  keys: string[];
  /** Modifier requirements. `false` means must NOT be held; `true` required; `undefined` either. */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Short human description used in command palette + help dialog. */
  description: string;
  /** Group label for the command palette. */
  group: 'View' | 'Playback' | 'Preset' | 'Export' | 'Help';
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const mod = isMac ? '⌘' : 'Ctrl';

export const SHORTCUTS: readonly Shortcut[] = [
  {
    action: 'palette.open',
    label: `${mod}K`,
    keys: ['k'],
    meta: true,
    description: 'Open command palette',
    group: 'View',
  },
  {
    action: 'palette.close',
    label: 'Esc',
    keys: ['escape'],
    description: 'Close palette / overlay',
    group: 'View',
  },
  {
    action: 'play.toggle',
    label: 'Space',
    keys: [' '],
    description: 'Play / pause the canvas',
    group: 'Playback',
  },
  {
    action: 'panel.layers.toggle',
    label: `${mod}1`,
    keys: ['1'],
    meta: true,
    description: 'Toggle layers panel',
    group: 'View',
  },
  {
    action: 'panel.inspector.toggle',
    label: `${mod}2`,
    keys: ['2'],
    meta: true,
    description: 'Toggle inspector panel',
    group: 'View',
  },
  {
    action: 'panel.timeline.toggle',
    label: `${mod}3`,
    keys: ['3'],
    meta: true,
    description: 'Toggle timeline panel',
    group: 'View',
  },
  {
    action: 'theme.toggle',
    label: `${mod}⇧L`,
    keys: ['l'],
    meta: true,
    shift: true,
    description: 'Toggle light / dark theme',
    group: 'View',
  },
  {
    action: 'preset.next',
    label: ']',
    keys: [']'],
    description: 'Next preset',
    group: 'Preset',
  },
  {
    action: 'preset.prev',
    label: '[',
    keys: ['['],
    description: 'Previous preset',
    group: 'Preset',
  },
  {
    action: 'export.lottie',
    label: `${mod}⇧E`,
    keys: ['e'],
    meta: true,
    shift: true,
    description: 'Download .lottie.json',
    group: 'Export',
  },
  {
    action: 'help.shortcuts',
    label: '?',
    keys: ['?'],
    shift: true,
    description: 'Show keyboard shortcuts',
    group: 'Help',
  },
];

export function shortcutFor(action: ShortcutAction): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.action === action);
}

/**
 * Match a KeyboardEvent against the shortcut table.
 * Returns the matched action or null.
 *
 * The match enforces explicit modifier states only when the
 * shortcut declares them — so `Space` triggers only when no
 * modifier is held, but ⌘K only when meta is held.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutAction | null {
  // Don't fire shortcuts while typing into an input / contenteditable.
  const target = e.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
      // Allow Escape and ⌘K even from inputs (they close / open palette).
      const exceptIsAllowed =
        e.key === 'Escape' || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey));
      if (!exceptIsAllowed) return null;
    }
  }

  const key = e.key.toLowerCase();
  for (const s of SHORTCUTS) {
    if (!s.keys.includes(key)) continue;
    const meta = e.metaKey || e.ctrlKey;
    if (s.meta !== undefined && s.meta !== meta) continue;
    if (s.meta === undefined && meta) continue;
    if (s.shift !== undefined && s.shift !== e.shiftKey) continue;
    if (s.shift === undefined && e.shiftKey && key !== '?') continue;
    if (s.alt !== undefined && s.alt !== e.altKey) continue;
    return s.action;
  }
  return null;
}
