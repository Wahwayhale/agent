import providerData from '../electron/api-adapter/providers.json'
import type { Provider } from './types'

export const PROVIDERS = providerData as Record<string, Provider>
