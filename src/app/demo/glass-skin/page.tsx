'use client';

// Glass-skin demo — renders the REAL homepage component, just inside
// the .glass-skin scope from the layout. Zero copy/paste of homepage
// markup means this stays in sync with whatever the live page is doing.
import Home from '@/app/page';

export default function GlassSkinDemoPage() {
  return <Home />;
}
