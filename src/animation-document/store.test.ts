import { describe, expect, it } from 'vitest'
import {
  InMemoryAnimationDocumentStore,
  InvalidDocumentCommitError,
  RevisionMismatchError,
  RevisionNotFoundError,
  next_revision_of
} from './store'
import { create_agent_wave_01_document } from './fixtures/AgentWave01'

describe('InMemoryAnimationDocumentStore', () => {
  it('starts with a valid committed document at revision 1', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    expect(store.current().revision).toBe(1)
    expect(store.history()).toHaveLength(1)
  })

  it('rejects an invalid initial document', () => {
    const document = create_agent_wave_01_document()
    document.clip.name = ''
    expect(() => new InMemoryAnimationDocumentStore(document)).toThrow(InvalidDocumentCommitError)
  })

  it('commits atomically and increments the revision exactly once', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    const next = next_revision_of(store.current())
    const receipt = store.commit(next)
    expect(receipt.revision).toBe(2)
    expect(store.current().revision).toBe(2)
    expect(store.history()).toHaveLength(2)
  })

  it('rejects revision jumps without changing state', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    const jumped = store.current()
    jumped.revision = 5
    expect(() => store.commit(jumped)).toThrow(RevisionMismatchError)
    expect(store.current().revision).toBe(1)
    expect(store.history()).toHaveLength(1)
  })

  it('rejects invalid commits without changing state', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    const next = next_revision_of(store.current())
    next.channels[0].keyframes[0].values[0] = Number.NaN
    expect(() => store.commit(next)).toThrow(InvalidDocumentCommitError)
    expect(store.current().revision).toBe(1)
  })

  it('undoes to a prior revision as an append-only commit', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    store.commit(next_revision_of(store.current()))
    store.commit(next_revision_of(store.current()))
    expect(store.history().map((document) => document.revision)).toEqual([1, 2, 3])
    const receipt = store.undo(1)
    expect(receipt.revision).toBe(4)
    expect(store.current().clip.name).toBe('Agent_Wave_01')
    expect(store.history().map((document) => document.revision)).toEqual([1, 2, 3, 4])
  })

  it('throws when undoing to a missing revision', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    expect(() => store.undo(99)).toThrow(RevisionNotFoundError)
  })

  it('isolates history from external mutation', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    const history = store.history()
    history[0].clip.name = 'mutated'
    history[0].channels[0].keyframes[0].values[0] = 999
    expect(store.current().clip.name).toBe('Agent_Wave_01')
    const current = store.current()
    current.clip.name = 'also mutated'
    expect(store.current().clip.name).toBe('Agent_Wave_01')
  })

  it('preserves validation state through a round-trip', () => {
    const store = new InMemoryAnimationDocumentStore(create_agent_wave_01_document())
    const next = next_revision_of(store.current())
    const receipt = store.commit(next)
    expect(receipt.document.validation.state).toBe('valid')
    expect(store.current().validation.errors).toEqual([])
  })
})
