// Writes Chart v1 / Timeline v1 as JSON Schema for the Python companion. Run: pnpm --filter @mq/model schema
import { writeFileSync } from 'node:fs'
import { jsonSchemas } from '../src/index.ts'

for (const [name, schema] of Object.entries(jsonSchemas())) {
  writeFileSync(new URL(`../schema/${name}`, import.meta.url), JSON.stringify(schema, null, 2) + '\n')
  console.log(`wrote schema/${name}`)
}
