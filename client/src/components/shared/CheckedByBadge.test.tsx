// FE-COMP-CHECKEDBY-001 to FE-COMP-CHECKEDBY-005
import { render, screen } from '../../../tests/helpers/render';
import CheckedByBadge from './CheckedByBadge';

describe('CheckedByBadge', () => {
  it('FE-COMP-CHECKEDBY-001: renders <img> when avatar URL is provided', () => {
    render(<CheckedByBadge username="alice" avatar="https://example.com/a.png" />);
    const el = screen.getByTestId('checked-by-badge');
    expect(el.tagName).toBe('IMG');
    expect(el).toHaveAttribute('src', 'https://example.com/a.png');
    expect(el).toHaveAttribute('title', 'Checked by alice');
  });

  it('FE-COMP-CHECKEDBY-002: renders initial letter circle when avatar is null', () => {
    render(<CheckedByBadge username="bob" avatar={null} />);
    const el = screen.getByTestId('checked-by-badge');
    expect(el.tagName).toBe('SPAN');
    expect(el.textContent).toBe('b');
    expect(el).toHaveAttribute('title', 'Checked by bob');
  });

  it('FE-COMP-CHECKEDBY-003: renders initial letter circle when avatar is undefined', () => {
    render(<CheckedByBadge username="Carol" />);
    const el = screen.getByTestId('checked-by-badge');
    expect(el.tagName).toBe('SPAN');
    expect(el.textContent).toBe('C');
  });

  it('FE-COMP-CHECKEDBY-004: respects size prop on avatar img', () => {
    render(<CheckedByBadge username="dan" avatar="x.png" size={24} />);
    const el = screen.getByTestId('checked-by-badge') as HTMLImageElement;
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');
  });

  it('FE-COMP-CHECKEDBY-005: defaults to 17px size', () => {
    render(<CheckedByBadge username="eve" />);
    const el = screen.getByTestId('checked-by-badge');
    expect(el.style.width).toBe('17px');
    expect(el.style.height).toBe('17px');
  });

  it('FE-COMP-CHECKEDBY-006: falls back to ? when username is empty', () => {
    render(<CheckedByBadge username="" />);
    const el = screen.getByTestId('checked-by-badge');
    expect(el.textContent).toBe('?');
  });
});
