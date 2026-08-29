type IconProps = React.SVGProps<SVGSVGElement>;

const defaultIconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// export const PlusIcon = ({ width = 24, height = 24, ...props }: IconProps) => (
//   <svg width={width} height={height} {...defaultIconProps} {...props}>
//     <path d="M12 5v14M5 12h14" />
//   </svg>
// );

// export const DocumentIcon = ({ width = 24, height = 24, ...props }: IconProps) => (
//   <svg width={width} height={height} {...defaultIconProps} {...props}>
//     <path d="M7 3.75h7l4 4V19a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 19V5A1.25 1.25 0 0 1 7 3.75Z" />
//     <path d="M14 3.75V8h4" />
//     <path d="M8.5 12h7M8.5 15.5h7" />
//   </svg>
// );

export const PdfIcon = ({ width = 24, height = 24, ...props }: IconProps) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 20 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    {/* Document */}
    <path
      d="M5.1 2.2A1.9 1.9 0 0 0 3.2 4.1v15.8a1.9 1.9 0 0 0 1.9 1.9h10.6a1.9 1.9 0 0 0 1.9-1.9V9.6L12.3 2.2H5.1Z"
      fill="#E2262B"
    />

    {/* Fold – taller so it properly meets the document cut */}
    <path
      d="M12.3 2.2v5.0a1.9 1.9 0 0 0 1.9 1.9h3.4L12.3 2.2Z"
      fill="#EB676A"
    />

    {/* PDF – larger & centered, almost full width */}
    <g fill="#fff">
      {/* P */}
      <path d="M4.35 11.35h1.85c.95 0 1.72.77 1.72 1.72v.95c0 .95-.77 1.72-1.72 1.72H5.6v1.5a.45.45 0 1 1-.9 0v-5.44c0-.25.2-.45.45-.45Zm1.1 1.05v2.3h.75c.4 0 .72-.32.72-.72v-.86c0-.4-.32-.72-.72-.72h-.75Z" />

      {/* D */}
      <path d="M8.55 11.35h1.15c1.45 0 2.65 1.18 2.65 2.65v.5c0 1.47-1.2 2.65-2.65 2.65H8.55a.45.45 0 0 1-.45-.45v-4.9c0-.25.2-.45.45-.45Zm.55 1.05v3.75h.6c.9 0 1.65-.73 1.65-1.65v-.45c0-.92-.75-1.65-1.65-1.65h-.6Z" />

      {/* F */}
      <path d="M13.0 11.35h2.85a.45.45 0 1 1 0 .9h-2.4v1.35h1.8a.45.45 0 1 1 0 .9h-1.8v2.4a.45.45 0 1 1-.9 0v-5.1c0-.25.2-.45.45-.45Z" />
    </g>
  </svg>
);