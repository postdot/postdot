const playwright = Bun.spawn(
    ['bun', 'x', 'playwright', 'test', 'e2e/access-219-password-reset.spec.ts'],
    {
        env: { ...Bun.env, HERALD_E2E_MAILPIT: 'true' },
        stderr: 'inherit',
        stdout: 'inherit',
    }
)

process.exitCode = await playwright.exited
