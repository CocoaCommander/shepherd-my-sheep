import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button/Button'
import { Dialog } from '../Dialog/Dialog'
import { TextField } from '../Field/Field'

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const close = () => {
    onClose?.()
    setOpen(false)
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>Log contact</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Log contact with Maria"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button>Save contact</Button>
          </>
        }
      >
        <TextField label="Comment" />
      </Dialog>
    </>
  )
}

async function openIt() {
  const opener = screen.getByRole('button', { name: 'Log contact' })
  await userEvent.click(opener)
  return opener
}

describe('Dialog', () => {
  it('renders nothing inside until opened', () => {
    render(<Harness />)
    expect(screen.queryByText('Log contact with Maria')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('opens as a modal named by its title, focusing the first field', async () => {
    render(<Harness />)
    await openIt()
    const dialog = screen.getByRole('dialog', { name: 'Log contact with Maria' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByRole('heading', { level: 2, name: 'Log contact with Maria' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save contact' })).toBeInTheDocument()
  })

  it('focuses the close button when the body has no control', async () => {
    render(
      <Dialog open onClose={() => {}} title="About">
        <p>Text only.</p>
      </Dialog>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = await openIt()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('stays open on Escape until the caller closes it', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Pinned">
        <TextField label="Comment" />
      </Dialog>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Pinned' })).toHaveAttribute('open')
  })

  it('closes from its 44px close button and returns focus', async () => {
    render(<Harness />)
    const opener = await openIt()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes from a footer button', async () => {
    render(<Harness />)
    const opener = await openIt()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('starts its content fresh on each open', async () => {
    render(<Harness />)
    await openIt()
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Coffee')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await openIt()
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('')
  })
})

describe('Dialog alert', () => {
  it('is a plain dialog without describedby by default', async () => {
    render(
      <Dialog open onClose={() => {}} title="Log contact">
        <p>Body text</p>
      </Dialog>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Log contact' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
  })

  it('becomes an alertdialog described by its body', async () => {
    render(
      <Dialog open alert onClose={() => {}} title="Delete “serving”?">
        <p>Recorded for 3 people.</p>
      </Dialog>,
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “serving”?' })
    expect(dialog).toHaveAccessibleDescription('Recorded for 3 people.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
