'use client';

import { Flame } from 'lucide-react';

export default function BannerPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] p-8">
      <h1 className="text-2xl font-bold mb-4 uppercase">X Banner Preview</h1>
      <p className="text-[var(--muted)] mb-8">
        Screenshot the banner below or right-click and save as image. X banner size is 1500x500px.
      </p>

      {/* Banner Container - 1500x500 scaled down for preview */}
      <div className="border border-[var(--border)] overflow-hidden inline-block">
        {/* Actual banner at 1500x500 scaled to 750x250 for preview */}
        <div
          id="banner"
          className="relative overflow-hidden"
          style={{
            width: '750px',
            height: '250px',
            background: '#0a0a0f',
          }}
        >
          {/* Purple/cyan gradient glow */}
          <div
            className="absolute blur-[80px] opacity-40"
            style={{
              width: '400px',
              height: '400px',
              background: '#8b5cf6',
              top: '-100px',
              left: '-100px',
            }}
          />
          <div
            className="absolute blur-[80px] opacity-30"
            style={{
              width: '300px',
              height: '300px',
              background: '#06b6d4',
              bottom: '-100px',
              right: '100px',
            }}
          />

          {/* Content */}
          <div className="relative z-10 h-full flex items-center justify-center gap-6">
            {/* Logo */}
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: '80px',
                height: '80px',
                background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              }}
            >
              <Flame className="w-12 h-12 text-white" />
            </div>

            {/* Text */}
            <div className="flex flex-col">
              <span
                className="text-5xl font-bold tracking-tight"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Proof Launch
              </span>
              <span className="text-lg text-[#737373] mt-1">
                Community-Curated Meme Coin Launchpad
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm text-[var(--muted)] mt-4">
        Preview shown at 50% scale. Actual banner is 1500x500px.
      </p>

      {/* Full size banner (hidden, for export) */}
      <div className="mt-12">
        <h2 className="text-xl font-bold mb-4 uppercase">Full Size Banner (1500x500)</h2>
        <p className="text-[var(--muted)] mb-4">
          Right-click this one to save, or take a screenshot.
        </p>
        <div className="border border-[var(--border)] overflow-hidden inline-block overflow-x-auto max-w-full">
          <div
            className="relative overflow-hidden"
            style={{
              width: '1500px',
              height: '500px',
              background: '#0a0a0f',
            }}
          >
            {/* Purple/cyan gradient glow */}
            <div
              className="absolute blur-[160px] opacity-40"
              style={{
                width: '800px',
                height: '800px',
                background: '#8b5cf6',
                top: '-200px',
                left: '-200px',
              }}
            />
            <div
              className="absolute blur-[160px] opacity-30"
              style={{
                width: '600px',
                height: '600px',
                background: '#06b6d4',
                bottom: '-200px',
                right: '200px',
              }}
            />

            {/* Content */}
            <div className="relative z-10 h-full flex items-center justify-center gap-12">
              {/* Logo */}
              <div
                className="flex items-center justify-center shadow-2xl rounded-3xl"
                style={{
                  width: '160px',
                  height: '160px',
                  background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                  boxShadow: '0 0 60px rgba(139, 92, 246, 0.5)',
                }}
              >
                <Flame className="w-24 h-24 text-white" />
              </div>

              {/* Text */}
              <div className="flex flex-col">
                <span
                  className="font-bold tracking-tight"
                  style={{
                    fontSize: '96px',
                    lineHeight: '1',
                    background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Proof Launch
                </span>
                <span
                  className="mt-2 tracking-wide"
                  style={{
                    fontSize: '32px',
                    color: '#737373',
                  }}
                >
                  Community-Curated Meme Coin Launchpad
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alternative minimal version */}
      <div className="mt-12">
        <h2 className="text-xl font-bold mb-4 uppercase">Minimal Version</h2>
        <div className="border border-[var(--border)] overflow-hidden inline-block">
          <div
            className="relative overflow-hidden flex items-center justify-center"
            style={{
              width: '1500px',
              height: '500px',
              background: '#0a0a0f',
            }}
          >
            {/* Single centered purple glow */}
            <div
              className="absolute blur-[200px] opacity-50"
              style={{
                width: '600px',
                height: '600px',
                background: '#8b5cf6',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />

            {/* Content */}
            <div className="relative z-10 flex items-center gap-8">
              <div
                className="flex items-center justify-center rounded-3xl"
                style={{
                  width: '120px',
                  height: '120px',
                  background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                  boxShadow: '0 0 40px rgba(139, 92, 246, 0.6)',
                }}
              >
                <Flame className="w-16 h-16 text-white" />
              </div>
              <span
                className="font-bold tracking-tight"
                style={{
                  fontSize: '72px',
                  background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Proof Launch
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
