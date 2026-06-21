import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

export interface ModelProviderSelection {
  model: string
  provider: string
}

const sameId = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function matchingModel(row: ModelOptionProvider, model: string): string {
  return String((row.models ?? []).find(candidate => sameId(String(candidate), model)) ?? '')
}

/** Repair a stale sticky composer pair such as `provider=nous` + `model=gpt-5.5`.
 *
 * The picker stores model/provider separately so a later default-provider change
 * can leave an old model id attached to the wrong provider. If the current
 * provider does not advertise the model but another configured provider does,
 * keep the model and move it back to that provider.
 */
export function repairStaleModelProviderSelection(
  options: ModelOptionsResponse | undefined,
  selection: ModelProviderSelection
): ModelProviderSelection {
  const model = selection.model.trim()
  const provider = selection.provider.trim()

  if (!model || !provider) {
    return { model, provider }
  }

  const rows = options?.providers ?? []
  const current = rows.find(row => sameId(String(row.slug ?? ''), provider))
  const currentModel = current ? matchingModel(current, model) : ''

  if (currentModel) {
    return { model: currentModel, provider: String(current!.slug) }
  }

  const replacement = rows.find(row => {
    if (sameId(String(row.slug ?? ''), provider)) {
      return false
    }

    if (row.authenticated === false && !row.is_user_defined) {
      return false
    }

    return Boolean(matchingModel(row, model))
  })

  if (!replacement) {
    return { model, provider }
  }

  return {
    model: matchingModel(replacement, model),
    provider: String(replacement.slug)
  }
}
