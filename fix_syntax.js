const fs = require('fs');
const path = 'd:/Antigravity workflows/JournAI/app.js';
let content = fs.readFileSync(path, 'utf8');

// The messed up part starts at L1081 with touchmove and ends at L1132 with pullDistance=0; });
// We replace the entire section from window.addEventListener('touchmove' ... up to the start of Highlights.
const touchSectionRegex = /window\.addEventListener\('touchmove'[\s\S]*?pullDistance = 0;\s*}\);/m;

const newTouchSection = `window.addEventListener('touchmove', (e) => {
    if (touchStartPos > 0 && window.scrollY === 0) {
        const currentPos = e.touches[0].pageY;
        pullDistance = currentPos - touchStartPos;
        
        if (pullDistance > 0) {
            // Visual indicator only - NO layout displacement
            const dampedDistance = Math.min(pullDistance * 0.4, 100);
            
            if (ptrIndicator) {
                ptrIndicator.style.transition = 'none';
                ptrIndicator.style.opacity = Math.min(pullDistance / 80, 1);
                const yPos = Math.min(-100 + dampedDistance, 0);
                ptrIndicator.style.transform = \`translateX(-50%) translateY(\${yPos}px)\`;
            }
            
            if (ptrSpinner) {
                ptrSpinner.style.transform = \`rotate(\${pullDistance * 2}deg)\`;
            }
        }
    }
}, { passive: true });

window.addEventListener('touchend', () => {
    if (pullDistance > PTR_THRESHOLD) {
        // Refreshing state - hold indicator in place
        if (ptrIndicator) {
            ptrIndicator.style.transition = 'transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.3s ease';
            ptrIndicator.style.transform = 'translateX(-50%) translateY(0px)';
            ptrIndicator.style.opacity = '1';
        }
        if (ptrSpinner) ptrSpinner.style.animationPlayState = 'running';
        
        // Brief delay before reload
        setTimeout(() => {
            window.location.reload();
        }, 600);
    } else {
        // Reset purely visual indicator
        if (ptrIndicator) {
            ptrIndicator.style.transition = 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.3s ease';
            ptrIndicator.style.transform = 'translateX(-50%) translateY(-100px)';
            ptrIndicator.style.opacity = '0';
        }
    }
    touchStartPos = 0;
    pullDistance = 0;
});`;

content = content.replace(touchSectionRegex, newTouchSection);
fs.writeFileSync(path, content);
console.log('Syntactic Repair Complete');
