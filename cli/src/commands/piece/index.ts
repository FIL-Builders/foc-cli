import { Cli } from 'incur'
import { listCommand } from './list.ts'
import { removeCommand } from './remove.ts'

export const piece = Cli.create('piece', {
  description: 'Piece management — browse and remove pieces from datasets',
})

piece.command('list', listCommand)
piece.command('remove', removeCommand)
