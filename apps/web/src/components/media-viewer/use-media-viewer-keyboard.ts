import { useEffect } from 'react'

export function useMediaViewerKeyboard(
    enabled: boolean,
    onPrevious: () => void,
    onNext: () => void
) {
    useEffect(() => {
        if (!enabled) return

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'ArrowLeft') {
                event.preventDefault()
                onPrevious()
            } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                onNext()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [enabled, onNext, onPrevious])
}
