import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NoteEditor } from './NoteEditor';

describe('NoteEditor Component (M3-T06 / SCR-CUST-05)', () => {
  it('renders optional note textarea, live counter, and approved DPDPA privacy notice', () => {
    render(
      <NoteEditor
        businessName="Luxe Salon"
        note=""
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
    expect(screen.getByLabelText(/Personal Note \(Optional/i)).toBeInTheDocument();
    expect(screen.getByText('0 / 150')).toBeInTheDocument();
    expect(screen.getByText(/Notes are stored pseudonymously and automatically deleted after 30 days/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit feedback/i })).toBeInTheDocument();
  });

  it('updates character count and calls onChangeNote when text is entered', async () => {
    const user = userEvent.setup();
    const changeSpy = vi.fn();

    render(
      <NoteEditor
        businessName="Luxe Salon"
        note="Great haircut!"
        onChangeNote={changeSpy}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('14 / 150')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: /Personal Note/i });
    await user.type(textarea, 'a');

    expect(changeSpy).toHaveBeenCalled();
  });

  it('enforces strict 150-character limit and caps pasted text', async () => {
    const user = userEvent.setup();
    const changeSpy = vi.fn();

    render(
      <NoteEditor
        businessName="Luxe Salon"
        note=""
        onChangeNote={changeSpy}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const longText = 'a'.repeat(160);
    const textarea = screen.getByRole('textbox', { name: /Personal Note/i });
    await user.click(textarea);
    await user.paste(longText);

    // The handler must cap at 150 characters
    expect(changeSpy).toHaveBeenCalledWith('a'.repeat(150));
  });

  it('handles multi-byte emoji character count accurately', () => {
    render(
      <NoteEditor
        businessName="Luxe Salon"
        note="💇✨☕"
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    // 💇 (2) + ✨ (1) + ☕ (1) = 4 chars (JS UTF-16 code units matching backend validator)
    expect(screen.getByText(/4 \/ 150/)).toBeInTheDocument();
  });

  it('permits submitting with an empty note (completely optional)', async () => {
    const user = userEvent.setup();
    const submitSpy = vi.fn();

    render(
      <NoteEditor
        businessName="Luxe Salon"
        note=""
        onChangeNote={vi.fn()}
        onSubmit={submitSpy}
        onBack={vi.fn()}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Submit feedback/i });
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('disables actions and indicates in-flight submitting state', () => {
    render(
      <NoteEditor
        businessName="Luxe Salon"
        note="Good service"
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        isSubmitting={true}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Submitting feedback/i });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent(/Submitting\.\.\./i);

    const backBtn = screen.getByRole('button', { name: /Back to question 3/i });
    expect(backBtn).toBeDisabled();

    const textarea = screen.getByRole('textbox', { name: /Personal Note/i });
    expect(textarea).toBeDisabled();
  });

  it('renders submission error alert when submissionError is provided', () => {
    render(
      <NoteEditor
        businessName="Luxe Salon"
        note="Good service"
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        submissionError="A network error occurred while submitting."
      />,
    );

    const alertBox = screen.getByRole('alert');
    expect(alertBox).toHaveTextContent(/A network error occurred while submitting/i);
  });

  it('calls onBack when Back button is clicked', async () => {
    const user = userEvent.setup();
    const backSpy = vi.fn();

    render(
      <NoteEditor
        businessName="Luxe Salon"
        note=""
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={backSpy}
      />,
    );

    const backBtn = screen.getByRole('button', { name: /Back to question 3/i });
    await user.click(backBtn);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('renders anti-gating direct Google review bypass button on note screen', async () => {
    const user = userEvent.setup();
    const googleSpy = vi.fn();
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <NoteEditor
        businessName="Luxe Salon"
        note=""
        onChangeNote={vi.fn()}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        targetGoogleUrl="https://search.google.com/local/writereview?placeid=123"
        onDirectGoogleClick={googleSpy}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i });
    expect(googleBtn).toBeInTheDocument();

    await user.click(googleBtn);
    expect(googleSpy).toHaveBeenCalledTimes(1);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://search.google.com/local/writereview?placeid=123',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
