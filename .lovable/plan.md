
# Fix: Player Controls Cut Off and Disappearing on Google Pixel 8

## Problem Summary
On a Google Pixel 8 (Chrome, Android with gesture navigation), the player controls are:
1. **Cut off at the bottom** - The lower portion of the control widget extends below the visible viewport
2. **Disappearing after fullscreen exit** - When exiting fullscreen mode, the controls vanish and don't reappear

Both issues occur in portrait and landscape orientations in the preview environment.

## Root Cause Analysis

### Issue 1: Controls Cut Off
The current implementation relies on `100dvh` (dynamic viewport height) and `env(safe-area-inset-bottom)` for mobile-safe layout. However, several factors are causing the controls to be pushed off-screen:

1. **Insufficient bottom padding** - The current `pb-4` (16px) and `calc(1rem+env(safe-area-inset-bottom))` may not be enough for Android gesture navigation, which typically requires 48-56px of clearance
2. **Missing html/body height constraints** - The `html` and `body` elements don't have explicit `height: 100%` set, which can cause inconsistent behavior with `100dvh` on some Android browsers
3. **Potential CSS specificity issues** - While `App.css` isn't imported in `main.tsx`, if any other styles affect `#root`, they could interfere with the layout

### Issue 2: Controls Disappear After Fullscreen
The current reflow fix toggles `display: none` then `display: ''` to force a browser recalculation. This approach has limitations:

1. **Timing issues** - The reflow may complete before the browser finishes its viewport recalculation
2. **Missing resize event** - Android Chrome may need an explicit `resize` event dispatch to recalculate `dvh` units
3. **No delayed re-render** - Some mobile browsers need a small delay after fullscreen exit before layout recalculates correctly

## Solution

### Part 1: Fix Controls Being Cut Off

**File: `src/index.css`**

Add explicit height constraints to `html` and `body`, and ensure the root element can expand edge-to-edge:

```css
@layer base {
  html, body, #root {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  
  body {
    @apply bg-background text-foreground;
    /* Prevent overscroll/bounce on mobile */
    overscroll-behavior: none;
    /* Prevent pull-to-refresh */
    overflow: hidden;
  }
}
```

**File: `src/components/visualizer/Visualizer.tsx`**

Increase the bottom padding to accommodate Android gesture navigation (which typically requires more space than iOS):

```tsx
// Current (line 73):
<div className="relative z-10 pb-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-8">

// Updated:
<div className="relative z-10 pb-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-8">
```

### Part 2: Fix Controls Disappearing After Fullscreen

**File: `src/components/visualizer/Visualizer.tsx`**

Enhance the fullscreen exit handler with:
1. A small delay before forcing the reflow
2. Dispatch a synthetic `resize` event to trigger viewport recalculation
3. Use `requestAnimationFrame` for better timing

```tsx
// Listen for fullscreen changes to force layout recalculation
useEffect(() => {
  const handleFullscreenChange = () => {
    const wasFullscreen = isFullscreen;
    const nowFullscreen = !!document.fullscreenElement;
    setIsFullscreen(nowFullscreen);
    
    // Force layout recalculation when EXITING fullscreen on mobile
    if (wasFullscreen && !nowFullscreen && containerRef.current) {
      // Use a small delay to let the browser finish its fullscreen transition
      setTimeout(() => {
        if (containerRef.current) {
          // Force a reflow by toggling display
          containerRef.current.style.display = 'none';
          // Read a layout property to force synchronous reflow
          void containerRef.current.offsetHeight;
          containerRef.current.style.display = '';
          
          // Dispatch resize event to trigger dvh recalculation
          window.dispatchEvent(new Event('resize'));
          
          // Additional reflow after a frame for stubborn browsers
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.style.opacity = '0.99';
              requestAnimationFrame(() => {
                if (containerRef.current) {
                  containerRef.current.style.opacity = '';
                }
              });
            }
          });
        }
      }, 100);
    }
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  };
}, [isFullscreen]);
```

### Part 3: Add Visual Viewport API Fallback (Optional Enhancement)

For more robust mobile support, use the Visual Viewport API to dynamically calculate available height:

**File: `src/hooks/useVisualViewport.ts`** (new file)

```tsx
import { useState, useEffect } from 'react';

export const useVisualViewport = () => {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    const updateHeight = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      }
    };

    updateHeight();
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateHeight);
      window.visualViewport.addEventListener('scroll', updateHeight);
    }
    window.addEventListener('resize', updateHeight);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateHeight);
        window.visualViewport.removeEventListener('scroll', updateHeight);
      }
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  return viewportHeight;
};
```

Then optionally use this in Visualizer.tsx to set an inline height style as a fallback when `100dvh` fails.

## Files to Modify

| File | Changes |
|------|---------|
| `src/index.css` | Add `html, body, #root` height constraints and overflow handling |
| `src/components/visualizer/Visualizer.tsx` | Increase bottom padding, enhance fullscreen exit handler with delay + resize event |
| `src/hooks/useVisualViewport.ts` | (Optional) New hook for Visual Viewport API fallback |

## Testing Checklist
- [ ] Controls fully visible on Pixel 8 (Chrome, gesture nav) in portrait
- [ ] Controls fully visible on Pixel 8 (Chrome, gesture nav) in landscape
- [ ] Controls reappear after exiting fullscreen on Pixel 8
- [ ] Controls still look correct on desktop browsers
- [ ] Fullscreen mode works correctly on all platforms
- [ ] No visual glitches during fullscreen transitions

---

## Technical Details

### Why `100dvh` isn't enough on Android
Android Chrome's implementation of dynamic viewport units can be inconsistent, especially with gesture navigation. The gesture bar height is approximately 48px, but `env(safe-area-inset-bottom)` may return 0 on some Android devices because it was originally designed for iOS notch handling.

### Why the reflow trick needs enhancement
The current implementation:
```tsx
containerRef.current.style.display = 'none';
containerRef.current.offsetHeight;
containerRef.current.style.display = '';
```
Executes synchronously, but the browser's viewport recalculation after fullscreen exit is asynchronous. Adding `setTimeout` and `dispatchEvent(new Event('resize'))` gives the browser time to complete its internal state updates before we force the reflow.

### Explicit height chain
Setting `height: 100%` on `html`, `body`, and `#root` creates an unbroken chain of height constraints that helps browsers calculate `100dvh` more reliably, particularly on Android where the rendering pipeline differs from iOS/desktop.
