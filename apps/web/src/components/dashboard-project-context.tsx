import { Button } from '@herald/ui/components/button'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { AddIcon } from '@solar-icons/react/bold/add'
import type { FormEvent } from 'react'

import type { Project } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardProjectContextProps {
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly selectedProjectId: string | null
}

export function DashboardProjectContext({
    onCreateProject,
    onProjectChange,
    onProjectNameChange,
    pending,
    projectName,
    projects,
    selectedProjectId,
}: DashboardProjectContextProps) {
    useLanguage()
    const noProject = m.nav_no_project_selected()
    return (
        <div className="space-y-4">
            <Field className="min-w-0 gap-1.5">
                <FieldLabel className="text-xs font-medium text-muted-foreground">
                    {m.nav_workspace()}
                </FieldLabel>
                <Select
                    items={Object.fromEntries([
                        ['__none__', noProject],
                        ...projects.map(project => [project.id, project.name]),
                    ])}
                    value={selectedProjectId}
                    onValueChange={value => onProjectChange(value === '__none__' ? null : value)}>
                    <SelectTrigger
                        aria-label={m.nav_select_project()}
                        className="h-9 w-full border-0 bg-sidebar-accent/45 px-2.5 shadow-none hover:bg-sidebar-accent focus-visible:ring-2">
                        <SelectValue placeholder={noProject} />
                    </SelectTrigger>
                    <SelectContent align="start">
                        <SelectItem value="__none__">{noProject}</SelectItem>
                        {projects.map(project => (
                            <SelectItem key={project.id} value={project.id}>
                                {project.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>

            <details className="group rounded-md bg-sidebar-accent/50 p-3 open:bg-sidebar-accent">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground transition-[color] hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <AddIcon aria-hidden="true" className="size-3.5" />
                    <span>{m.nav_create_project()}</span>
                </summary>
                <form className="mt-3 grid gap-2" onSubmit={onCreateProject}>
                    <Field>
                        <FieldLabel className="sr-only" htmlFor="new-project">
                            {m.nav_new_project()}
                        </FieldLabel>
                        <Input
                            id="new-project"
                            required
                            value={projectName}
                            onChange={event => onProjectNameChange(event.target.value)}
                            placeholder={m.nav_project_name()}
                            className="h-9"
                        />
                    </Field>
                    <Button size="sm" type="submit" disabled={pending}>
                        <AddIcon aria-hidden="true" />
                        {m.nav_add_project()}
                    </Button>
                </form>
            </details>
        </div>
    )
}
