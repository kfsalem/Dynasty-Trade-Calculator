import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallButton, InstallCard } from './InstallApp';
import { isIos, resetInstall } from '../hooks/useInstall';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

function asDevice(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  // jsdom has no `maxTouchPoints`, so it is defined rather than spied on.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetInstall();
});

describe('isIos', () => {
  it('knows an iPhone, and an iPad that calls itself a Mac', () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(MAC, 5)).toBe(true);
    expect(isIos(MAC, 0)).toBe(false);
  });
});

describe('installing the app (#171)', () => {
  it('walks an iPhone through Add to Home Screen, from the card and the header', async () => {
    asDevice(IPHONE, 5);
    render(
      <>
        <InstallButton />
        <InstallCard />
      </>,
    );
    expect(screen.getByRole('region', { name: 'Use it like an app' })).toHaveTextContent(
      'Add to Home Screen',
    );
    await userEvent.click(screen.getByLabelText('Install the app'));
    expect(screen.getAllByText('Add to Home Screen')).toHaveLength(2);
  });

  it('offers the browser’s own install dialog where there is one', async () => {
    asDevice(MAC);
    render(<InstallCard />);
    expect(screen.queryByRole('region', { name: 'Use it like an app' })).not.toBeInTheDocument();

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Install the app' }));
    expect(prompt).toHaveBeenCalled();
    // Installed: nothing left to offer.
    expect(screen.queryByRole('region', { name: 'Use it like an app' })).not.toBeInTheDocument();
  });

  it('offers nothing where a browser cannot install', () => {
    asDevice(MAC);
    render(
      <>
        <InstallButton />
        <InstallCard />
      </>,
    );
    expect(screen.queryByLabelText('Install the app')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Use it like an app' })).not.toBeInTheDocument();
  });

  it('keeps the card away once dismissed, and leaves the header button', async () => {
    asDevice(IPHONE, 5);
    const { unmount } = render(<InstallCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Use it like an app' })).not.toBeInTheDocument();
    unmount();

    render(
      <>
        <InstallButton />
        <InstallCard />
      </>,
    );
    expect(screen.queryByRole('region', { name: 'Use it like an app' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Install the app')).toBeInTheDocument();
  });
});
