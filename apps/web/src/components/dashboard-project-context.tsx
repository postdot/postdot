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

import type { Project, ProjectCategory } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface DashboardProjectContextProps {
    readonly categories: readonly ProjectCategory[]
    readonly onCreateProject: (event: FormEvent<HTMLFormElement>) => void
    readonly onProjectChange: (projectId: string | null) => void
    readonly onProjectCategoryChange: (projectId: string, categoryId: string | null) => void
    readonly onProjectNameChange: (value: string) => void
    readonly pending: boolean
    readonly projectName: string
    readonly projects: readonly Project[]
    readonly selectedProjectId: string | null
}

export function DashboardProjectContext({
    categories,
    onCreateProject,
    onProjectChange,
    onProjectCategoryChange,
    onProjectNameChange,
    pending,
    projectName,
    projects,
    selectedProjectId,
}: DashboardProjectContextProps) {
    useLanguage()
    const noProject = m.nav_no_project_selected()
    const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null
    const selectedCategory =
        selectedProject === null
            ? null
            : (categories.find(category => category.id === selectedProject.primaryCategoryId) ??
              null)
    const categoryOptions = categories.filter(
        category => category.state === 'active' || category.id === selectedCategory?.id
    )
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

            {selectedProject !== null && categories.length > 0 ? (
                <Field className="min-w-0 gap-1.5">
                    <FieldLabel className="text-xs font-medium text-muted-foreground">
                        {m.nav_category()}
                    </FieldLabel>
                    <Select
                        items={Object.fromEntries([
                            ['__none__', m.nav_no_category()],
                            ...categoryOptions.map(category => [category.id, category.name]),
                        ])}
                        value={selectedProject.primaryCategoryId ?? '__none__'}
                        onValueChange={value =>
                            onProjectCategoryChange(
                                selectedProject.id,
                                value === '__none__' ? null : value
                            )
                        }>
                        <SelectTrigger
                            aria-label={m.nav_category()}
                            className="h-8 w-full border-0 bg-sidebar-accent/25 px-2.5 text-xs shadow-none hover:bg-sidebar-accent focus-visible:ring-2"
                            disabled={pending}>
                            <SelectValue placeholder={m.nav_no_category()} />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="__none__">{m.nav_no_category()}</SelectItem>
                            {categoryOptions.map(category => (
                                <SelectItem
                                    key={category.id}
                                    disabled={category.state === 'archived'}
                                    value={category.id}>
                                    {category.name}
                                    {category.state === 'archived'
                                        ? ` · ${m.common_archived()}`
                                        : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            ) : null}

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
