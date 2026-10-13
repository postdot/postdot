import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.DB_FILE_NAME ?? '../../postbot.sqlite',
    },
    out: './drizzle',
    schema: './src/schema.ts',
})
