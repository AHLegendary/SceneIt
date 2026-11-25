// Small shared components that the page tests only touch in passing.

import { fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mount, screen } from './helpers/harness.js'

const load = {
  ArrowScroller: () => import('../../src/components/ArrowScroller.jsx'),
  Avatar: () => import('../../src/components/Avatar.jsx'),
  ErrorBoundary: () => import('../../src/components/ErrorBoundary.jsx'),
  Poster: () => import('../../src/components/Poster.jsx'),
}

function Boom() {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing fails', async () => {
    await mount(load.ErrorBoundary, { children: createElement('p', null, 'fine') })
    expect(screen.getByText('fine')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a reload prompt instead of a blank page when a child throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    const { user } = await mount(load.ErrorBoundary, { children: createElement(Boom) })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Something went wrong')
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom' }))
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('Poster', () => {
  it('shows the image, and falls back to a titled placeholder when it fails', async () => {
    await mount(load.Poster, { title: 'Dune', src: 'http://x/p.jpg' })
    const img = screen.getByRole('img', { name: 'Dune poster' })
    fireEvent.error(img)
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('.poster--blank').textContent).toBe('Dune')
  })

  it('uses a placeholder, tinted the same way each time, without a src', async () => {
    const tint = async () => {
      const { view } = await mount(load.Poster, { title: 'Dune', size: 'sm' })
      const value = view.container.querySelector('.poster--sm').style.getPropertyValue('--tint')
      view.unmount()
      return value
    }
    expect(await tint()).toMatch(/^#/)
    expect(await tint()).toBe(await tint())
  })
})

describe('Avatar', () => {
  it('falls back to the initial when there is no image URL', async () => {
    await mount(load.Avatar, { userId: null, username: 'alice' })
    expect(document.querySelector('.avatar--initial').textContent).toBe('A')
  })

  it('shows "?" with no username', async () => {
    await mount(load.Avatar, { userId: null })
    expect(document.querySelector('.avatar--initial').textContent).toBe('?')
  })

  it('falls back to the initial when the picture fails to load', async () => {
    const { view } = await mount(load.Avatar, { userId: 'u1', username: 'bob' })
    fireEvent.error(view.container.querySelector('img.avatar'))
    expect(view.container.querySelector('.avatar--initial').textContent).toBe('B')
  })
})

describe('ArrowScroller', () => {
  it('scrolls by the larger of 240px or 80% of its width, in the arrow direction', async () => {
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} }
    const { view, user } = await mount(load.ArrowScroller, { label: 'Trending', className: 'strip', children: createElement('span', null, 'x') })
    const strip = view.container.querySelector('.strip')
    strip.scrollBy = vi.fn()
    Object.defineProperty(strip, 'clientWidth', { value: 500, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Scroll Trending right', hidden: true }))
    expect(strip.scrollBy).toHaveBeenLastCalledWith({ left: 400, behavior: 'smooth' })
    await user.click(screen.getByRole('button', { name: 'Scroll Trending left', hidden: true }))
    expect(strip.scrollBy).toHaveBeenLastCalledWith({ left: -400, behavior: 'smooth' })
  })
})
