import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: '../backend/graphql/schema.graphql',
  documents: 'src/**/*.graphql',
  generates: {
    'src/generated/graphql.ts': {
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-apollo',
      ],
      config: {
        // Custom scalars would otherwise be typed `any`.
        scalars: { UUID: 'string', Date: 'string', DateTime: 'string' },
      },
    },
  },
}

export default config
