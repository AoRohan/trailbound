// @vitest-environment jsdom
/**
 * End-to-end through the real UI: mount the app, walk, read the report, spend
 * salvage. Catches the class of bug the pure-logic tests cannot — a screen that
 * throws on render, a prop that never arrives, a button wired to nothing.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/ui/App'
import { LocalStorageAdapter } from '../src/storage/LocalStorageAdapter'
import { ManualStepSource } from '../src/steps/ManualStepSource'
import { newGame } from '../src/game/save'

beforeAll(() => {
  // jsdom implements neither of these, and the route canvas uses both.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function mount() {
  const storage = new LocalStorageAdapter()
  const source = new ManualStepSource()
  render(<App storage={storage} source={source} />)
  return { storage, source }
}

describe('the app', () => {
  it('renders the trail once the save has loaded', async () => {
    mount()
    expect(await screen.findByText('The Verdant Mile')).toBeTruthy()
    expect(screen.getByText(/steps today/)).toBeTruthy()
  })

  it('walks the party and shows a report when steps are added', async () => {
    mount()
    await screen.findByText('The Verdant Mile')

    await act(async () => {
      fireEvent.click(screen.getByText('+2,500'))
    })

    // The report overlay tells the story of the walk. The step count appears in
    // both the header and the day entry, so match all of them.
    await waitFor(() => expect(screen.getByText('While you were walking')).toBeTruthy())
    expect(screen.getAllByText(/2,500 steps/).length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByText('Continue'))
    })

    // Back on the trail, today's total has moved.
    await waitFor(() => expect(screen.getAllByText('2,500').length).toBeGreaterThan(0))
  })

  it('persists progress across a reload', async () => {
    const first = mount()
    await screen.findByText('The Verdant Mile')

    await act(async () => {
      fireEvent.click(screen.getByText('+1,000'))
    })
    await waitFor(() => expect(screen.getByText('While you were walking')).toBeTruthy())

    cleanup()

    // A second mount reads the same localStorage the first one wrote.
    render(<App storage={first.storage} source={new ManualStepSource()} />)
    await waitFor(() => expect(screen.getAllByText('1,000').length).toBeGreaterThan(0))
  })

  it('moves between tabs', async () => {
    mount()
    await screen.findByText('The Verdant Mile')

    fireEvent.click(screen.getByText('Camp'))
    expect(await screen.findByText('salvage in store')).toBeTruthy()

    fireEvent.click(screen.getByText('Journal'))
    expect(await screen.findByText('How to earn bonuses')).toBeTruthy()

    fireEvent.click(screen.getByText('Settings'))
    expect(await screen.findByText('Daily goal')).toBeTruthy()
  })

  it('spends salvage on a camp upgrade', async () => {
    const storage = new LocalStorageAdapter()
    const rich = newGame()
    rich.camp.salvage = 5000
    await storage.save(rich)

    render(<App storage={storage} source={new ManualStepSource()} />)
    await screen.findByText('The Verdant Mile')

    fireEvent.click(screen.getByText('Camp'))
    await screen.findByText('Hearth')

    // The Hearth's buy button is labelled with its price.
    const priceButton = screen.getAllByRole('button').find((b) => b.textContent === '40')
    expect(priceButton).toBeTruthy()

    await act(async () => {
      fireEvent.click(priceButton!)
    })

    await waitFor(() => expect(screen.getByText('+8 max HP')).toBeTruthy())
  })

  it('records a training check-in', async () => {
    mount()
    await screen.findByText('The Verdant Mile')

    await act(async () => {
      fireEvent.click(screen.getByText('Log a training session'))
    })

    await waitFor(() => expect(screen.getByText('💪 Training logged today')).toBeTruthy())
    expect(screen.getByText('Iron Body')).toBeTruthy()
  })

  it('changes the daily goal', async () => {
    mount()
    await screen.findByText('The Verdant Mile')

    fireEvent.click(screen.getByText('Settings'))
    await screen.findByText('Daily goal')

    await act(async () => {
      fireEvent.click(screen.getByText('10,000'))
    })

    fireEvent.click(screen.getByText('Trail'))
    await waitFor(() => expect(screen.getByText(/goal 10,000/)).toBeTruthy())
  })

  it('starts a fresh game when the stored save is corrupt', async () => {
    localStorage.setItem('trailbound.save.v1', '{"totally": "broken"')
    mount()
    expect(await screen.findByText('The Verdant Mile')).toBeTruthy()
  })
})
