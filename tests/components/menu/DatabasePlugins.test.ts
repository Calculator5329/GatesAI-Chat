import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DatabasePluginsSection,
  type DatabasePluginRow,
  type DatabasePluginsSectionProps,
} from '../../../src/components/menu/sections/DatabasePlugins'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function render(props: DatabasePluginsSectionProps): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(createElement(DatabasePluginsSection, props))
  })
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

const samplePlugin: DatabasePluginRow = {
  id: 'com.example.people',
  version: '1.0.0',
  description: 'People directory.',
  publisher: 'Example Publisher',
  enabled: true,
  dataPolicy: 'local_only',
  capabilities: ['catalog.read', 'search.read'],
  datasets: [{ id: 'people', title: 'People' }],
}

describe('DatabasePluginsSection', () => {
  it('shows a desktop-only explainer in Web Lite and never lists plugins', () => {
    const el = render({ plugins: [samplePlugin], desktop: false })
    expect(el.textContent).toContain('desktop-only')
    expect(el.textContent).not.toContain('com.example.people')
  })

  it('shows an honest empty state on desktop with no plugins', () => {
    const el = render({ plugins: [], desktop: true })
    expect(el.textContent).toContain('No database plugins installed')
  })

  it('lists installed plugins with policy and capabilities on desktop', () => {
    const el = render({ plugins: [samplePlugin], desktop: true })
    expect(el.textContent).toContain('com.example.people')
    expect(el.textContent).toContain('v1.0.0')
    expect(el.textContent).toContain('local-only')
    expect(el.textContent).toContain('search.read')
    expect(el.textContent).toContain('Example Publisher')
  })

  it('delegates remove to the callback', () => {
    const onRemove = vi.fn()
    const el = render({ plugins: [samplePlugin], desktop: true, onRemove })
    const removeButton = [...el.querySelectorAll('button')].find(b => b.textContent === 'Remove')
    expect(removeButton).toBeTruthy()
    act(() => { removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onRemove).toHaveBeenCalledWith('com.example.people')
  })
})
