# shadcn/ui Base UI Skills

A skill for AI coding agents to use correct patterns when using shadcn/ui components with Base UI. Prevents LLMs from incorrectly suggesting Radix UI patterns (asChild, etc.).

## The Problem

Newer shadcn/ui projects prefer to use Base UI instead of Radix UI, but because LLMs are trained on old data, they usually suggest `asChild` prop (Radix) instead of `render` prop (Base UI). It can be very annoying to fix this manually every time.

This skill addresses this issue by guiding the AI agent to use the correct patterns and props for shadcn/ui components when using Base UI as opposed to Radix UI.

## Installation

```bash
npx skills add ThunderboltDev/shadcn-baseui
```

## Usage

AI agents will automatically pick up on the correct patterns when using shadcn components.
