'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'Can the engine actually run on my laptop?',
    a: 'Yes. The CLI builds and runs on macOS, Linux, and Windows. SAM 2 inference is handled by a Python sidecar — slow on CPU (~60s for a 2s reference clip) but works without a GPU. With an Apple Silicon M3 or a CUDA GPU it&apos;s an order of magnitude faster.',
  },
  {
    q: 'What format do I get back?',
    a: 'Two files per generation: a self-contained Lottie JSON timeline (editable in LottieFiles, Adobe After Effects via Bodymovin, Rive, or programmatically) and an H.264 MP4 at whatever composition you asked for. The Lottie embeds source illustrations as base64 image layers, so there are no missing-asset surprises.',
  },
  {
    q: 'How do you avoid generating off-brand garbage?',
    a: 'Three guardrails. (1) Theme presets — corporate, playful, tech-reveal, minimalist, explainer — that lock palette, easing, shot rhythm and a system-prompt addendum. (2) Style extraction from a reference clip so the LLM only chooses from your actual brand colors. (3) A JSON Schema on the LLM output so the timeline always matches our renderer.',
  },
  {
    q: 'Which LLM does it use, and can I bring my own?',
    a: 'Local-first: Ollama if reachable on localhost:11434 (any installed model). Then LM Studio. Then Azure OpenAI if AZURE_OPENAI_ENDPOINT is set. Then Anthropic or OpenAI direct via API key. Then a deterministic Mock backend so the pipeline never hard-fails. The probe order is auto-detected; you can pin one via env var.',
  },
  {
    q: 'What if the LLM hallucinates an invalid Lottie?',
    a: 'It can&apos;t. We constrain the LLM with a JSON Schema (Azure OpenAI, OpenAI, and LM Studio all honour json_schema response_format; Ollama gets the schema in the prompt). If the parse still fails we fall back to a deterministic procedural timeline derived from the style card, so you always get a render.',
  },
  {
    q: 'How does pricing work at 10,000 renders a month?',
    a: 'Roughly: Azure OpenAI for the LLM (~$900/mo at gpt-5 standard tier — drop to ~$300 with Phi-4 on AI Foundry serverless), $360 in GPU time on ACA Workload Profile T4, $150 in CPU render, and ~$300 across Front Door / storage / Cosmos / Redis. ~$1.8k/mo all-in for the medium tier. The self-hosted tier is whatever your hardware costs.',
  },
  {
    q: 'How do you handle our brand assets?',
    a: 'Self-hosted: they never leave your machine. Cloud-managed: they live in Blob Storage in your Azure tenant, encrypted at rest, accessible only via the User-Assigned Managed Identity bound to the API. Enterprise: full single-tenant deployment with VNet isolation, customer-managed keys, and audit logs piped to your SIEM.',
  },
  {
    q: 'Is the source open?',
    a: 'Apache-2.0. Every crate, every script, every Bicep template. Fork it, vendor it, embed it. The Cloud-managed and Enterprise tiers pay for the operational layer (deploy, observability, on-call), not the source.',
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section bg-bg-secondary">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Frequently asked</p>
          <h2 className="h-section mt-3">Questions execs and engineers actually ask.</h2>
        </div>
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border-light rounded-2xl border border-border-light bg-bg-primary shadow-soft">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold text-text-primary sm:text-base">{f.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-text-tertiary transition ${isOpen ? 'rotate-180 text-accent-600' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-6 text-sm leading-relaxed text-text-secondary">{f.a}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
