import { closeDatabase, createDatabase } from './client'
import { runMigrations } from './migrations'

const database = createDatabase(process.env.DB_FILE_NAME ?? '../../herald.sqlite')

runMigrations(database)
closeDatabase(database)

console.log('Database migrations applied.')
