
# Smooth Fullscreen Exit Transition

## Problem
When exiting fullscreen mode, there's visible jitter/thrashing of elements because:
1. The browser takes time to complete its fullscreen exit transition
2. During the 200ms delay before remount, the layout may be in an incorrect state
3. The component then suddenly remounts, causing an abrupt visual "snap"

## Solution
Add a fade-out/fade-in transition to mask the layout recalculation. Instead of an abrupt remount, the component will:
1. Fade to black when exiting fullscreen
2. Perform the remount while hidden
3. Fade back in once the layout is stable

## Technical Approach

### State Changes
Add a new `isTransitioning` state to control the fade animation:
- When fullscreen exit is detected, set `isTransitioning = true` (triggers fade-out)
- After fade-out completes (~150ms), trigger the remount
- After remount, wait one frame, then set `isTransitioning = false` (triggers fade-in)

### CSS Animation
Add a simple opacity transition to the container with a quick duration (150-200ms). The transition will use the existing Tailwind utilities:
- `transition-opacity duration-150`
- `opacity-0` when transitioning, `opacity-100` when stable

### Implementation

**File: `src/components/visualizer/Visualizer.tsx`**

```tsx
const Visualizer = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remountKey, setRemountKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const nowFullscreen = !!document.fullscreenElement;
      const wasFullscreen = isFullscreen;
      setIsFullscreen(nowFullscreen);
      
      if (wasFullscreen && !nowFullscreen) {
        // Step 1: Start fade-out immediately
        setIsTransitioning(true);
        
        // Step 2: After fade-out, trigger remount
        setTimeout(() => {
          setRemountKey(k => k + 1);
          
          // Step 3: After remount + 1 frame, fade back in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setIsTransitioning(false);
            });
          });
        }, 200); // Matches fade duration + browser settle time
      }
    };
    // ... event listeners
  }, [isFullscreen]);

  return (
    <div
      key={remountKey}
      ref={containerRef}
      className={`fixed inset-0 flex flex-col ... transition-opacity duration-200 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* ... children unchanged ... */}
    </div>
  );
};
```

### Why This Works
- The fade masks the moment when the layout is recalculating
- Users see a quick, intentional fade transition instead of elements jumping around
- The 200ms duration is fast enough to feel responsive but slow enough to hide the jitter
- Using `requestAnimationFrame` twice ensures the DOM has fully painted before fading back in

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/visualizer/Visualizer.tsx` | Add `isTransitioning` state, fade-out/fade-in logic, and transition classes |

## Alternative Considered
Using a black overlay that fades in/out instead of fading the whole container. This would be slightly more complex but could provide a more "cinematic" feel. The simpler opacity approach should work well for this use case.
