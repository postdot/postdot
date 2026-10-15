import { mountFigure } from './figure.js'

let cleanup = []
function mount() {
    cleanup = [...document.querySelectorAll('.view')].map(mountFigure)
}
mount()
window.addEventListener('pagehide', () => cleanup.forEach(destroy => destroy()))
window.addEventListener('pageshow', event => {
    if (event.persisted) mount()
})
