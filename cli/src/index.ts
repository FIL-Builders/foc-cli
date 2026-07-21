#!/usr/bin/env node
import { Cli } from 'incur'
import packageJson from '../package.json' with { type: 'json' }
import { dataset } from './commands/dataset/index.ts'
import { docsCommand } from './commands/docs.ts'
import { downloadCommand } from './commands/download.ts'
import { multiUploadCommand } from './commands/multi-upload.ts'
import { piece } from './commands/piece/index.ts'
import { provider } from './commands/provider/index.ts'
import { uploadCommand } from './commands/upload.ts'
import { wallet } from './commands/wallet/index.ts'

const cli = Cli.create('foc-cli', {
  version: packageJson.version,
  // Single source of truth: npm, the CLI banner, and --llms all tell the
  // same story.
  description: packageJson.description,
  sync: {
    include: ['_root'],
    suggestions: [
      'initialize wallet with foc-cli wallet init --auto',
      'upload multiple files to Filecoin warm storage',
      'check wallet balances and payment account info',
      'create a new PDP dataset with a storage provider',
    ],
  },
})

// Mount subcommand groups
cli.command(wallet)
cli.command(dataset)
cli.command(piece)
cli.command(provider)

// Top-level multi-upload (most common operation)
cli.command('multi-upload', multiUploadCommand)
cli.command('upload', uploadCommand)
cli.command('download', downloadCommand)
cli.command('docs', docsCommand)

cli.serve()

export default cli
