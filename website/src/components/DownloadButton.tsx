function DownloadButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="download-button" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}

export default DownloadButton;
