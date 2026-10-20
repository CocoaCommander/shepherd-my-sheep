import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// jsdom has <dialog> but not its modal methods. This stands in for what Dialog relies on:
// showModal/close toggle `open`, and Escape fires a cancelable `cancel` that closes unless
// prevented. It can't trap focus or make the page inert; the browser does that.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  const onKeyDown = function (this: HTMLDialogElement, e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (this.dispatchEvent(new Event('cancel', { cancelable: true }))) this.close()
  }
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
    this.addEventListener('keydown', onKeyDown)
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return
    this.open = false
    this.removeEventListener('keydown', onKeyDown)
    this.dispatchEvent(new Event('close'))
  }
}
