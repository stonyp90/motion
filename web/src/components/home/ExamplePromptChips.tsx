'use client';

interface Props {
  onPick: (prompt: string) => void;
}

/**
 * Four canned prompts. Shown below the prompt textarea while the user
 * hasn't typed anything yet — the empty-state suggestion pattern.
 * Clicking a chip fills the textarea (the parent calls `onPick`).
 */
const EXAMPLES: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'SaaS launch teaser',
    prompt:
      'A 20 second teaser announcing our v2 launch. Crisp emerald accents, a UI mockup sliding in, then a hard cut to our wordmark.',
  },
  {
    label: 'Pricing explainer',
    prompt:
      'Explain our three pricing tiers. Each tier as a card that flies in, with the recommended tier scaling up at the end.',
  },
  {
    label: 'Conference promo',
    prompt:
      'Conference promo: kinetic typography listing 6 speakers, ends on date + city. Bouncy, vivid, 15 seconds.',
  },
  {
    label: 'Quarterly recap',
    prompt:
      'Quarterly recap reel for investors. 4 stat cards (ARR, NPS, headcount, churn) animating in sequence. Calm and decelerated.',
  },
];

export function ExamplePromptChips({ onPick }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Example prompts">
      <span className="text-2xs font-medium uppercase tracking-[0.16em] text-text-tertiary">
        Try
      </span>
      {EXAMPLES.map((ex) => (
        <button
          key={ex.label}
          type="button"
          onClick={() => onPick(ex.prompt)}
          className="rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-xs text-text-secondary transition hover:border-accent-300 hover:bg-accent-50 hover:text-text-primary"
        >
          {ex.label}
        </button>
      ))}
    </div>
  );
}
