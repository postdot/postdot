import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'

import './preview.css'

const preview: Preview = {
    parameters: {
        controls: {
            expanded: true,
        },
        layout: 'fullscreen',
    },
    decorators: [
        withThemeByClassName({
            themes: {
                Clair: '',
                Sombre: 'dark',
            },
            defaultTheme: 'Sombre',
        }),
    ],
}

export default preview
