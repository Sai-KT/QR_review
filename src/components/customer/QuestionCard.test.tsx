import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QuestionCard } from './QuestionCard';
import type { SurveyQuestionDto } from '../../lib/api/survey';

describe('QuestionCard Component (M3-T06 / SCR-CUST-02..04)', () => {
  const mockQuestion: SurveyQuestionDto = {
    id: '11111111-1111-4111-8111-111111111111',
    displayOrder: 1,
    questionText: 'How was your hair service today?',
    options: [
      {
        id: 'opt-pos-1',
        optionText: 'Masterful & Precise',
        emojiAnchor: '💇',
        sentiment: 'positive',
        isNeutralNa: false,
      },
      {
        id: 'opt-neu-1',
        optionText: 'Met Expectations',
        emojiAnchor: '👍',
        sentiment: 'neutral',
        isNeutralNa: false,
      },
      {
        id: 'opt-neg-1',
        optionText: 'Service took too long',
        emojiAnchor: '⏳',
        sentiment: 'negative',
        isNeutralNa: false,
      },
      {
        id: 'opt-na-1',
        optionText: 'Not Applicable',
        emojiAnchor: '⚪',
        sentiment: 'neutral',
        isNeutralNa: true,
      },
    ],
  };

  it('renders question text in semantic legend and displays progress info', () => {
    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        totalSteps={3}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '1');
    expect(progressbar).toHaveAttribute('aria-valuemin', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '3');

    // Semantic legend
    expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    expect(screen.getByText('Luxe Salon')).toBeInTheDocument();
  });

  it('renders all options including positive, neutral, negative and N/A with equal visual access', () => {
    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/💇 Masterful & Precise/i)).toBeInTheDocument();
    expect(screen.getByText(/👍 Met Expectations/i)).toBeInTheDocument();
    expect(screen.getByText(/⏳ Service took too long/i)).toBeInTheDocument();
    expect(screen.getByText(/⚪ Not Applicable/i)).toBeInTheDocument();
  });

  it('calls onSelectOption when an option card is clicked', async () => {
    const user = userEvent.setup();
    const selectSpy = vi.fn();

    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId={null}
        onSelectOption={selectSpy}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const negativeOption = screen.getByText(/Service took too long/i);
    await user.click(negativeOption);

    expect(selectSpy).toHaveBeenCalledWith('opt-neg-1');
  });

  it('allows selecting the neutral N/A option legitimately', () => {
    const selectSpy = vi.fn();

    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId="opt-na-1"
        onSelectOption={selectSpy}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const naRadio = screen.getByDisplayValue('opt-na-1');
    expect(naRadio).toBeChecked();
  });

  it('disables Next button when no option is selected', () => {
    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const nextBtn = screen.getByRole('button', { name: /Select an option to proceed/i });
    expect(nextBtn).toBeDisabled();
  });

  it('enables Next button when an option is selected and calls onNext', async () => {
    const user = userEvent.setup();
    const nextSpy = vi.fn();

    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId="opt-pos-1"
        onSelectOption={vi.fn()}
        onNext={nextSpy}
        onBack={vi.fn()}
      />,
    );

    const nextBtn = screen.getByRole('button', { name: /Next to question 2/i });
    expect(nextBtn).toBeEnabled();

    await user.click(nextBtn);
    expect(nextSpy).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when Back button is clicked', async () => {
    const user = userEvent.setup();
    const backSpy = vi.fn();

    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={2}
        selectedOptionId="opt-pos-1"
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
        onBack={backSpy}
      />,
    );

    const backBtn = screen.getByRole('button', { name: /Back to question 1/i });
    await user.click(backBtn);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('renders anti-gating direct Google review bypass button and handles click', async () => {
    const user = userEvent.setup();
    const googleSpy = vi.fn();
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
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

  it('renders honest generic Google Maps fallback when google review URL is unconfigured', () => {
    render(
      <QuestionCard
        businessName="Luxe Salon"
        categoryId="salon"
        question={mockQuestion}
        stepNumber={1}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        targetGoogleUrl={null}
      />,
    );

    expect(screen.getByRole('button', { name: /Search on Google Maps ↗/i })).toBeInTheDocument();
  });
});

