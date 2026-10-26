import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './button.tsx';

describe('Button component (M1-T03 UI Primitive)', () => {
  it('renders button with children text', () => {
    render(<Button>Generate Review</Button>);
    const button = screen.getByRole('button', { name: /generate review/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('renders with accessible type="submit" when specified', () => {
    render(<Button type="submit">Submit Feedback</Button>);
    const button = screen.getByRole('button', { name: /submit feedback/i });
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('dispatches click events via user interactions', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={handleClick}>Tap Action</Button>);
    const button = screen.getByRole('button', { name: /tap action/i });

    await user.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('handles disabled state preventing click handler execution', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={handleClick}>
        Disabled Button
      </Button>,
    );
    const button = screen.getByRole('button', { name: /disabled button/i });

    expect(button).toBeDisabled();
    await user.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders loading state with aria-busy and disabled semantics', () => {
    render(<Button isLoading>Generating Draft</Button>);
    const button = screen.getByRole('button', { name: /generating draft/i });

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeDisabled();
  });

  it('applies variant styling classes correctly', () => {
    const { rerender } = render(<Button variant="accent">Accent Action</Button>);
    let button = screen.getByRole('button', { name: /accent action/i });
    expect(button.className).toContain('bg-brand-accent');

    rerender(<Button variant="destructive">Delete Item</Button>);
    button = screen.getByRole('button', { name: /delete item/i });
    expect(button.className).toContain('bg-destructive');
  });

  it('applies touch-target-preferred class for mobile touch ergonomically', () => {
    render(<Button size="touch">Mobile Touch Action</Button>);
    const button = screen.getByRole('button', { name: /mobile touch action/i });
    expect(button.className).toContain('touch-target-preferred');
  });
});
