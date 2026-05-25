// TODO: W3 implements — replaced by the streaming-voice mic button.
// Default export keeps the import shape stable so PromptInput can
// render `<VoiceButton />` without conditional code.

import { Mic } from 'lucide-react';

export default function VoiceButton() {
  return (
    <button
      type="button"
      disabled
      aria-label="Voice input (coming soon)"
      title="Voice input — coming soon"
      className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-border-light bg-bg-secondary text-text-tertiary opacity-60"
      data-testid="voice-button-stub"
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
