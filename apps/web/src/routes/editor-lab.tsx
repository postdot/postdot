import { createFileRoute, redirect } from '@tanstack/react-router'
import { lazy } from 'react'

import { AppToaster } from '@/components/app-toaster'

const EditorExperimentPage = lazy(() =>
    import('@/components/editor-experiment-page').then(module => ({
        default: module.EditorExperimentPage,
    }))
)

export const Route = createFileRoute('/editor-lab')({
    beforeLoad: () => {
        if (!import.meta.env.DEV) throw redirect({ to: '/' })
    },
    component: EditorLab,
})

function EditorLab() {
    return (
        <>
            <EditorExperimentPage />
            <AppToaster />
        </>
    )
}
