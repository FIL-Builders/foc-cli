import { Cli } from 'incur'
import { createCommand } from './create.ts'
import { detailsCommand } from './details.ts'
import { listCommand } from './list.ts'
import { terminateCommand } from './terminate.ts'

export const dataset = Cli.create('dataset', {
  description: 'PDP dataset management — list, create, and terminate',
})

dataset.command('list', listCommand)
dataset.command('details', detailsCommand)
dataset.command('create', createCommand)
dataset.command('terminate', terminateCommand)
