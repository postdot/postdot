import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.DB_FILE_NAME ?? '../../herald.sqlite',
    },
    out: './drizzle',
    schema: './src/schema.ts',
})
