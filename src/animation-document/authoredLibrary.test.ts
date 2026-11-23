import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTHORED_ID_TAG_PREFIX,
  authored_id_from_tags,
  can_delete_animation,
  delete_authored_document,
  load_authored_documents,
  save_authored_document
} from './authoredLibrary'
import { create_empty_document, with_animation_channel } from './create'
import { make_test_rig } from '../authoringObservation/testFixtures'

function document_fixture () {
  const skeleton = make_test_rig().skeleton
  let document = create_empty_document({ skeleton, rig_identifier: 'human', clip_name: 'Saved_Jump', duration_seconds: 1 })
  document = with_animation_channel(document, {
    bone_id: document.bones[0].id,
    property: 'position',
    keyframes: [{ time_seconds: 0, values: [0, 0, 0], interpolation: 'linear' }]
  })
  return document
}

describe('authored clip library persistence and deletion protection', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('protects bundled animations and allows user/MCP clips', () => {
    expect(can_delete_animation({
      id: 'animations/human/Angry.glb',
      file: 'animations/human/Angry.glb',
      metadata: { source_type: 'default-library', tags: [] }
    })).toBe(false)
    expect(can_delete_animation({
      id: 'custom-import-1',
      metadata: { source_type: 'custom-import', tags: ['authored-animation-document'] }
    })).toBe(true)
    expect(can_delete_animation({
      id: 'custom-import-2',
      file: 'some/path.glb',
      metadata: { source_type: 'custom-import', tags: [] }
    })).toBe(false)
  })

  it('saves, reloads and deletes authored documents', () => {
    const document = document_fixture()
    const id = save_authored_document(document, 'Idle_A')
    const entries = load_authored_documents()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(id)
    expect(entries[0].document.clip.name).toBe('Saved_Jump')
    expect(entries[0].source_name).toBe('Idle_A')
    expect(delete_authored_document(id)).toBe(true)
    expect(load_authored_documents()).toHaveLength(0)
  })

  it('restores persisted documents into the application-owned library', async () => {
    const { skeleton } = make_test_rig()
    const document = document_fixture()
    const id = save_authored_document(document, null)
    const added: Array<{ tags: string[] }> = []
    const listing = {
      add_authored_animation: (pair: { metadata: { tags: string[] } }) => {
        added.push({ tags: pair.metadata.tags })
        return { id: `custom-import-${added.length}` }
      }
    }
    const { restore_authored_documents } = await import('./authoredLibrary')
    const restored = restore_authored_documents(listing as never, skeleton, 'human')
    expect(restored).toBe(1)
    expect(added[0].tags).toContain('authored-animation-document')
    expect(added[0].tags).toContain(`${AUTHORED_ID_TAG_PREFIX}${id}`)
    // A second call in the same session must not duplicate the entry.
    expect(restore_authored_documents(listing as never, skeleton, 'human')).toBe(0)
  })

  it('reads the authored id back from library tags', () => {
    const tags = ['authored-animation-document', `${AUTHORED_ID_TAG_PREFIX}authored-1`, 'rig:human']
    expect(authored_id_from_tags(tags)).toBe('authored-1')
    expect(authored_id_from_tags(['rig:human'])).toBeNull()
  })
})
