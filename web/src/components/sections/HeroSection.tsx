'use client';

import { Sparkles, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const panelStrip = [
  '/demos/chrono-sample-1.png',
  '/demos/chrono-sample-2.png',
  '/demos/chrono-sample-3.png',
  '/demos/chrono-sample-1.png',
  '/demos/chrono-sample-2.png',
  '/demos/chrono-sample-3.png',
];

export function HeroSection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  return (
    <section className="relative overflow-hidden bg-hero-grid">
      <div className="container relative z-10 pt-20 pb-16 sm:pt-28 lg:pt-32 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-motion bg-motion-50 px-3 py-1 text-xs font-medium text-motion-700">
            <Sparkles className="h-3.5 w-3.5" />
            <span>License the engine. Stop paying per video.</span>
          </div>

          <h1 className="heading-xl mt-6">
            Motion design at the speed of <span className="text-motion">your roadmap.</span>
          </h1>

          <p className="mt-6 body-lg">
            Drop your illustration pack, type a prompt, get a broadcast-ready
            MP4 + editable Lottie in <span className="font-semibold text-text-primary">90 seconds</span>.
            Iteration thereafter is sub-second. Self-host or call our API — your call.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#cta" className="btn-motion w-full sm:w-auto">
              Book a 20-minute exec demo
            </a>
            <a href="#how-it-works" className="btn-motion-outline w-full sm:w-auto">
              See how it works
            </a>
          </div>

          <p className="mt-5 text-xs text-text-tertiary">
            Used by brand, growth and product teams that would rather ship than wait on an agency.
          </p>
        </div>

        {/* Video frame */}
        <div className="relative mx-auto mt-14 max-w-5xl">
          <div className="rounded-3xl border border-border-light bg-bg-primary p-2 shadow-lift">
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-primary-900">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                src="/demos/chrono.mp4"
                muted
                playsInline
                loop
                preload="metadata"
                poster="/demos/chrono-sample-2.png"
              />
              {!playing && (
                <button
                  onClick={togglePlay}
                  aria-label="Play demo"
                  className="absolute inset-0 grid place-items-center bg-primary-900/30 transition hover:bg-primary-900/20"
                >
                  <span className="grid h-20 w-20 place-items-center rounded-full bg-motion text-white shadow-motion-lg transition hover:scale-105">
                    <Play className="h-7 w-7 translate-x-0.5" />
                  </span>
                </button>
              )}
              <div className="pointer-events-none absolute left-4 top-4 flex flex-col items-start gap-1.5">
                <span className="chip border-motion bg-motion-50/90 text-motion-700">
                  rendered locally
                </span>
                <span className="chip border-primary-200/50 bg-bg-primary/90 text-primary-700">
                  22 panels · 30s · 1080p · 30fps
                </span>
              </div>
            </div>
          </div>

          {/* Drifting panel strip behind the video — proof of "this is your art, in motion" */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-12 left-1/2 hidden w-[140%] -translate-x-1/2 opacity-60 sm:block"
          >
            <div className="overflow-hidden mask-fade">
              <div className="flex w-max gap-4 animate-panel-drift">
                {panelStrip.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="h-28 w-auto rounded-xl border border-border-light shadow-card"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .mask-fade {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 12%,
            black 88%,
            transparent 100%
          );
          mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 12%,
            black 88%,
            transparent 100%
          );
        }
      `}</style>
    </section>
  );
}
