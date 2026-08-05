import Conf from 'conf'
import packageJson from '../package.json' with { type: 'json' }

const schema = {
  keystore: {
    type: 'string',
  },
  privateKey: {
    type: 'string',
  },
  source: {
    type: 'string',
  },
  // A reference to a key held by an external secret manager, written as
  // `<provider>:<ref>` — e.g. `clawdi:FILECOIN_PRIVATE_KEY`. Only ever written
  // by `wallet init --key-ref`, so it is absent on every existing install and
  // there is nothing to migrate: an absent field means the behaviour below it
  // is untouched.
  keyRef: {
    type: 'string',
  },
  // Optional scope for that reference. Absent means "let the provider pick its
  // own default", which is the common case.
  keyRefProject: {
    type: 'string',
  },
}

const config = new Conf<{
  privateKey: string
  keystore: string
  source: string
  keyRef: string
  keyRefProject: string
}>({
  projectName: packageJson.name,
  projectVersion: packageJson.version,
  schema,
})

export default config
