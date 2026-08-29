import { betterAuth } from 'better-auth/minimal'

// This configuration is used by the Better Auth CLI to generate the Drizzle
// schema. The API injects the real database through createAuth at runtime.
export const auth = betterAuth({
    account: {
        encryptOAuthTokens: true,
        accountLinking: {
            allowDifferentEmails: true,
            disableImplicitLinking: true,
        },
    },
    emailAndPassword: {
        enabled: true,
    },
})
