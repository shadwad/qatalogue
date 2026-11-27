interface ShimmerProps {
  children: string;
  className?: string;
  as?: 'span' | 'div';
}

/**
 * A loading word with a highlight sweeping across it.
 * The highlight is a copy of the word seen through a moving window. Both move by transform alone, which the browser
 * animates off the main thread, so the sweep keeps going while the page is busy building a list or a network.
 */
export function Shimmer({ children, className = '', as: Tag = 'span' }: ShimmerProps) {
  return (
    <Tag className={className}>
      <span className="shimmer">
        {children}
        <span aria-hidden="true" className="shimmer-window">
          <span className="shimmer-band">
            <span className="shimmer-band-text">{children}</span>
          </span>
        </span>
      </span>
    </Tag>
  );
}
