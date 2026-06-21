import { describe, expect, it } from 'vitest'

import type { ModelOptionsResponse } from '@/types/hermes'

import { repairStaleModelProviderSelection } from './model-provider-compat'

const options = {
  providers: [
    { authenticated: true, models: ['openai/gpt-5.5', 'stepfun/step-3.7-flash:free'], slug: 'nous' },
    { authenticated: true, models: ['gpt-5.5', 'gpt-5.4-mini'], slug: 'openai-codex' },
    { authenticated: true, models: ['gpt-5.5'], slug: 'copilot' }
  ]
} as ModelOptionsResponse

describe('repairStaleModelProviderSelection', () => {
  it('moves a stale bare GPT model back to the provider that owns that id', () => {
    expect(
      repairStaleModelProviderSelection(options, {
        model: 'gpt-5.5',
        provider: 'nous'
      })
    ).toEqual({
      model: 'gpt-5.5',
      provider: 'openai-codex'
    })
  })

  it('keeps a provider/model pair that is already valid', () => {
    expect(
      repairStaleModelProviderSelection(options, {
        model: 'openai/gpt-5.5',
        provider: 'nous'
      })
    ).toEqual({
      model: 'openai/gpt-5.5',
      provider: 'nous'
    })
  })

  it('leaves unknown pairs alone when no configured provider owns the model', () => {
    expect(
      repairStaleModelProviderSelection(options, {
        model: 'some/private-model',
        provider: 'custom'
      })
    ).toEqual({
      model: 'some/private-model',
      provider: 'custom'
    })
  })
})
